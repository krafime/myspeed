/**
 *
 * This file is part of speed-cloudflare-cli (https://github.com/KNawm/speed-cloudflare-cli),
 * which is released under the MIT License.
 *
 * This file has been modified to be used inside MySpeed.
 *
 * Copyright (c) 2020 Tomás Arias
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const { performance } = require("perf_hooks");
const https = require("https");
const interfaces = require("../util/loadInterfaces");
const config = require("../controller/config");

function average(values) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
        total += values[i];
    }
    return total / values.length;
}

function median(values) {
    const half = Math.floor(values.length / 2);
    values.sort((a, b) => a - b);
    if (values.length % 2) return values[half];
    return (values[half - 1] + values[half]) / 2;
}

function quartile(values, percentile) {
    values.sort((a, b) => a - b);
    const pos = (values.length - 1) * percentile;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (values[base + 1] !== undefined) {
        return values[base] + rest * (values[base + 1] - values[base]);
    }
    return values[base];
}

function jitter(values) {
    let jitters = [];
    for (let i = 0; i < values.length - 1; i += 1) {
        jitters.push(Math.abs(values[i] - values[i + 1]));
    }
    return average(jitters);
}

async function get(hostname, path) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname,
                path,
                method: "GET",
            },
            (res) => {
                const body = [];
                res.on("data", (chunk) => {
                    body.push(chunk);
                });
                res.on("end", () => {
                    try {
                        resolve(Buffer.concat(body).toString());
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );

        req.on("error", (err) => {
            reject(err);
        });

        req.end();
    });
}

function fetchCfCdnCgiTrace() {
    const parseCfCdnCgiTrace = (text) =>
        text
            .split("\n")
            .map((i) => {
                const j = i.split("=");
                return [j[0], j[1]];
            })
            .reduce((data, [k, v]) => {
                if (v === undefined) return data;
                data[k] = v;
                return data;
            }, {});
    return get("speed.cloudflare.com", "/cdn-cgi/trace").then(parseCfCdnCgiTrace);
}

function request(options, data = "") {
    let started;
    let dnsLookup;
    let tcpHandshake;
    let sslHandshake;
    let ttfb;
    let ended;

    options.agent = new https.Agent(options);

    return new Promise((resolve, reject) => {
        started = performance.now();
        const req = https.request(options, (res) => {
            res.once("readable", () => {
                ttfb = performance.now();
            });
            res.on("data", () => {});
            res.on("end", () => {
                ended = performance.now();
                resolve([started, dnsLookup, tcpHandshake, sslHandshake, ttfb, ended, parseFloat(res.headers["server-timing"]?.slice(22))]);
            });
        });

        req.on("socket", (socket) => {
            socket.on("lookup", () => {
                dnsLookup = performance.now();
            });
            socket.on("connect", () => {
                tcpHandshake = performance.now();
            });
            socket.on("secureConnect", () => {
                sslHandshake = performance.now();
            });
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

function download(hostname, bytes) {
    const options = {
        hostname,
        path: `/__down?bytes=${bytes}`,
        method: "GET",
    };
    return request(options);
}

function upload(hostname, bytes) {
    const data = "0".repeat(bytes);
    const options = {
        hostname,
        path: "/__up",
        method: "POST",
        headers: {
            "Content-Length": Buffer.byteLength(data),
        },
    };
    return request(options, data);
}

function measureSpeed(bytes, duration) {
    return (bytes * 8) / (duration / 1000) / 1e6;
}

async function measureLatency(hostname) {
    const measurements = [];
    for (let i = 0; i < 20; i += 1) {
        await download(hostname, 1000).then(
            (response) => {
                measurements.push(response[4] - response[0] - response[6]);
            },
            (error) => {
                console.log(`Error while pinging: ${error}`);
            },
        );
    }
    return [Math.min(...measurements), Math.max(...measurements), average(measurements), median(measurements), jitter(measurements)];
}

async function measureDownload(hostname, bytes, iterations) {
    const measurements = [];
    for (let i = 0; i < iterations; i += 1) {
        await download(hostname, bytes).then(
            (response) => {
                const transferTime = response[5] - response[4];
                measurements.push(measureSpeed(bytes, transferTime));
            },
            (error) => {
                console.log(`Error while downloading: ${error}`);
            },
        );
    }
    return measurements;
}

async function measureUpload(hostname, bytes, iterations) {
    const measurements = [];
    for (let i = 0; i < iterations; i += 1) {
        await upload(hostname, bytes).then(
            (response) => {
                const transferTime = response[6];
                measurements.push(measureSpeed(bytes, transferTime));
            },
            (error) => {
                console.log(`Error while uploading: ${error}`);
            },
        );
    }
    return measurements;
}

function logInfo(text, data) {
    console.log(`${text.padEnd(15)}: ${data}`);
}

function logLatency(data) {
    console.log(`Latency       : ${data[3].toFixed(2)} ms`);
    console.log(`Jitter        : ${data[4].toFixed(2)} ms`);
}

function logDownloadSpeed(tests) {
    console.log(`Download speed: ${quartile(tests, 0.9).toFixed(2)} Mbps`);
}

function logUploadSpeed(tests) {
    console.log(`Upload speed  : ${quartile(tests, 0.9).toFixed(2)} Mbps`);
}

module.exports = async function speedTest() {
    let result = {};
    try {
        const currentInterface = await config.getValue("interface");
        const interfaceIp = interfaces.interfaces[currentInterface];
        if (!interfaceIp) {
            throw new Error("Invalid interface");
        }

        const [ping, { ip, loc, colo }] = await Promise.all([measureLatency("speed.cloudflare.com"), fetchCfCdnCgiTrace()]);

        const city = "Jakarta";
        const serverCode = "CGK";

        logInfo("Server location", `${city} (${serverCode})`);
        logInfo("Your IP", `${ip} (${loc})`);
        logLatency(ping);

        const testDown1 = await measureDownload("speed.cloudflare.com", 101000, 1);
        const testDown2 = await measureDownload("speed.cloudflare.com", 1001000, 8);
        const testDown3 = await measureDownload("speed.cloudflare.com", 10001000, 6);
        const testDown4 = await measureDownload("speed.cloudflare.com", 25001000, 4);
        const testDown5 = await measureDownload("speed.cloudflare.com", 100001000, 1);

        const downloadTests = [...testDown1, ...testDown2, ...testDown3, ...testDown4, ...testDown5];
        logDownloadSpeed(downloadTests);

        const testUp1 = await measureUpload("speed.cloudflare.com", 11000, 10);
        const testUp2 = await measureUpload("speed.cloudflare.com", 101000, 10);
        const testUp3 = await measureUpload("speed.cloudflare.com", 1001000, 8);
        const uploadTests = [...testUp1, ...testUp2, ...testUp3];
        logUploadSpeed(uploadTests);

        result = {
            ping: Math.round(ping[3]),
            download: quartile(downloadTests, 0.9).toFixed(2),
            upload: quartile(uploadTests, 0.9).toFixed(2),
        };
    } catch (error) {
        console.error("Error while using Cloudflare speedtest: " + error.message);
        result = { error: error.message };
    }
    return result;
};
