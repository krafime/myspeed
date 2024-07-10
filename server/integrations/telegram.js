const axios = require("axios");
const moment = require("moment-timezone");
const { replaceVariables } = require("../util/helpers");

const defaults = {
    finished: "✨ *A speedtest is finished*\n🏓 `Ping`: %ping% ms\n🔼 `Upload`: %upload% Mbps\n🔽 `Download`: %download% Mbps\n📅 `Date`: %currentDate%",
    failed: "❌ *A speedtest has failed*\n`Reason`: %error%\n📅 `Date`: %currentDate%"
};

const postWebhook = async (token, chatId, message, triggerActivity) => {
    axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        text: message,
        chat_id: chatId,
        parse_mode: "markdown"
    })
    .then(() => triggerActivity())
    .catch(() => triggerActivity(true));
};

function formatDate(date, timezone) {
    return moment(date).tz(timezone).format("DD-MM-YYYY HH:mm:ss");
}

module.exports = (registerEvent) => {
    registerEvent('testFinished', async (integration, data, activity) => {
        if (integration.data.send_finished) {
            data.currentDate = formatDate(new Date(), "Asia/Jakarta");  // Calculate currentDate for each event
            await postWebhook(integration.data.token, integration.data.chat_id,
                replaceVariables(integration.data.finished_message || defaults.finished, data), activity);
        }
    });

    registerEvent('testFailed', async (integration, error, activity) => {
        if (integration.data.send_failed) {
            const errorData = {
                error,
                currentDate: formatDate(new Date(), "Asia/Jakarta")  // Calculate currentDate for each event
            };
            await postWebhook(integration.data.token, integration.data.chat_id,
                replaceVariables(integration.data.failed_message || defaults.failed, errorData), activity);
        }
    });

    return {
        icon: "fa-brands fa-telegram",
        fields: [
            { name: "token", type: "text", required: true, regex: /(\d+):[a-zA-Z0-9_-]+/ },
            { name: "chat_id", type: "text", required: true, regex: /\d+/ },
            { name: "send_finished", type: "boolean", required: false },
            { name: "finished_message", type: "textarea", required: false },
            { name: "send_failed", type: "boolean", required: false },
            { name: "error_message", type: "textarea", required: false }
        ]
    };
};
