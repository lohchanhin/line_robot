// 引入必要的套件
const { google } = require('googleapis');
const line = require('@line/bot-sdk');
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config(); // 載入 .env 文件的環境變量

// 配置 Line Messaging API
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

// 初始化 Express 應用
const app = express();

// 暫存當天的對話內容
let conversationLog = [];
let currentDate = new Date().toISOString().split('T')[0]; // 當天日期（格式為 YYYY-MM-DD）

// 設置 webhook 路由
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// 處理每個事件的函數
const handleEvent = async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userMessage = event.message.text;
    const timestamp = new Date(event.timestamp).toISOString();
    const messageDate = timestamp.split('T')[0]; // 取得消息的日期（格式為 YYYY-MM-DD）

    // 如果是新的一天，重置 conversationLog
    if (messageDate !== currentDate) {
        conversationLog = [];
        currentDate = messageDate;
    }

    // 如果消息內容為「整理」，則觸發整理流程
    if (userMessage === '整理') {
        try {
            if (conversationLog.length === 0) {
                return { type: 'text', text: '今天沒有可整理的對話內容。' };
            }

            // 整理當天的所有對話內容
            const allMessages = conversationLog.join('\n');
            const processedMessage = await processWithLLM(allMessages);

            // 將整理後的消息寫入 Google Docs
            await writeToGoogleDocs({ timestamp, message: processedMessage });

            // 回應用戶，告知已完成整理
            return { type: 'text', text: '已完成當天資料整理並保存至 Google Docs。' };
        } catch (error) {
            console.error('Error processing event:', error);
            return { type: 'text', text: '資料整理過程中發生錯誤，請稍後再試。' };
        }
    } else {
        // 保存非「整理」指令的對話內容
        conversationLog.push(`[${timestamp}] ${userMessage}`);
        return Promise.resolve(null); // 不回應其他消息
    }
};

// 使用 OpenAI API 處理消息，改用 GPT-4 模型
const processWithLLM = async (message) => {
    const apiKey = process.env.OPENAI_API_KEY;

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                { role: 'system', content: '你是專業的資料整理助手，負責簡化和摘要用戶提供的資料。' },
                { role: 'user', content: `整理以下對話內容：\n\n${message}` },
            ],
            max_tokens: 150,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error with OpenAI API:', error);
        throw error;
    }
};

// 將數據寫入 Google Docs
const writeToGoogleDocs = async (data) => {
    const docs = google.docs({ version: 'v1', auth: getAuth() });
    const docId = process.env.GOOGLE_DOC_ID;

    const content = `日期: ${data.timestamp.split('T')[0]}\n\n${data.message}`;

    try {
        await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: { index: 1 },
                            text: content,
                        },
                    },
                ],
            },
        });
    } catch (error) {
        console.error('Error writing to Google Docs:', error);
        throw error;
    }
};

// 獲取授權
const getAuth = () => {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/documents'],
    });
    return auth;
};

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
