const axios = require("axios");
const { replaceVariables } = require("../util/helpers");

const defaults = {
    finished: "✨ *A speedtest is finished*\n🏓 `Ping`: %ping% ms\n🔼 `Upload`: %upload% Mbps\n🔽 `Download`: %download% Mbps\n📅 `Date`: %currentDate%",
    failed: "❌ *A speedtest has failed*\n`Reason`: %error%\n📅 `Date`: %currentDate%"
};

const postWebhook = async (token, chatId, message, triggerActivity) => {
    axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        text: message, chat_id: chatId, parse_mode: "markdown"
    })
        .then(() => triggerActivity())
        .catch(() => triggerActivity(true));
}

function formatDate(date, offset) {
    // Create a new date object based on the offset (in minutes)
    const utc = date.getTime() + (date.getTimezoneOffset() * 6000);
    const localDate = new Date(utc + (3600000 * offset));

    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const hours = String(localDate.getHours()).padStart(2, '0');
    const minutes = String(localDate.getMinutes()).padStart(2, '0');
    const seconds = String(localDate.getSeconds()).padStart(2, '0');

    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

const currentDate = formatDate(new Date(), 7); // Set the offset to +7 hours

module.exports = (registerEvent) => {
    registerEvent('testFinished', async (integration, data, activity) => {
        if (integration.data.send_finished) {
            data.currentDate = currentDate;  // Add currentDate to data object
            await postWebhook(integration.data.token, integration.data.chat_id,
                replaceVariables(integration.data.finished_message || defaults.finished, data), activity)
        }
    });

    registerEvent('testFailed', async (integration, error, activity) => {
        if (integration.data.send_failed) {
            const errorData = { error, currentDate };  // Add currentDate to error object
            await postWebhook(integration.data.token, integration.data.chat_id,
                replaceVariables(integration.data.failed_message || defaults.failed, errorData), activity)
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
}
