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

  try {
    // 處理消息，例如通過大型語言模型整理
    const processedMessage = await processWithLLM(userMessage);

    // 將整理後的消息寫入 Google Sheets
    await writeToGoogleSheets({ timestamp, message: processedMessage });
  } catch (error) {
    console.error('Error processing event:', error);
  }

  return Promise.resolve(null);
};

// 使用 OpenAI API 處理消息
const processWithLLM = async (message) => {
  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const response = await axios.post('https://api.openai.com/v1/completions', {
      model: 'text-davinci-003',
      prompt: `整理以下對話內容：\n\n${message}`,
      max_tokens: 150,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    return response.data.choices[0].text.trim();
  } catch (error) {
    console.error('Error with OpenAI API:', error);
    throw error;
  }
};

// 將數據寫入 Google Sheets
const writeToGoogleSheets = async (data) => {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const range = 'Sheet1!A:B';

  const values = [
    [data.timestamp, data.message],
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: { values },
    });
  } catch (error) {
    console.error('Error writing to Google Sheets:', error);
    throw error;
  }
};

// 獲取授權
const getAuth = () => {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const tempPath = path.join(__dirname, 'service-account-temp.json');
  fs.writeFileSync(tempPath, JSON.stringify(serviceAccount));

  const auth = new google.auth.GoogleAuth({
    keyFile: tempPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
};

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
