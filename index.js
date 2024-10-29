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

  // 僅在收到 "整理" 兩字時觸發 OpenAI 整理
  if (userMessage === '整理') {
    try {
      // 處理消息，通過大型語言模型 (GPT-4) 整理
      const processedMessage = await processWithLLM(userMessage);

      // 將整理後的消息寫入 Google Sheets
      await writeToGoogleSheets({ timestamp, message: processedMessage });

      // 回應用戶，告知已完成整理
      return { type: 'text', text: '已完成資料整理並保存至 Google Sheets。' };
    } catch (error) {
      console.error('Error processing event:', error);
      return { type: 'text', text: '資料整理過程中發生錯誤，請稍後再試。' };
    }
  } else {
    // 非整理指令的回應
    return { type: 'text', text: '請輸入「整理」以啟動資料整理程序。' };
  }
};

// 使用 OpenAI API 處理消息，改用 GPT-4 模型
const processWithLLM = async (message) => {
  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
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
