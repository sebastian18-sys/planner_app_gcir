const axios = require("axios");
require("dotenv").config();

const jiraClient = axios.create({
    baseURL: `${process.env.JIRA_BASE_URL}/rest/api/3`,
    auth: {
        username: process.env.JIRA_EMAIL,
        password: process.env.JIRA_API_TOKEN,
    },
    headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
    },
    timeout: 30000,
});

module.exports = jiraClient;