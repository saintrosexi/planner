const https = require('https');

function telRequest(token, method, payload = null) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const options = {
      method: payload ? 'POST' : 'GET',
      headers: {}
    };
    
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    
    if (payload) {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Token, X-Telegram-Chat-Id');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const token = req.headers['x-telegram-bot-token'] || req.query.token;
  const chatId = req.headers['x-telegram-chat-id'] || req.query.chatId;
  
  if (!token || !chatId) {
    return res.status(400).json({ success: false, error: 'Missing token or chatId' });
  }
  
  if (req.method === 'GET') {
    try {
      const chatInfo = await telRequest(token, 'getChat', { chat_id: chatId });
      if (!chatInfo.ok) {
        return res.status(400).json({ success: false, error: chatInfo.description });
      }
      
      const pinned = chatInfo.result.pinned_message;
      if (!pinned || !pinned.document || pinned.document.file_name !== 'db.json') {
        return res.status(200).json({ isNew: true });
      }
      
      const fileInfo = await telRequest(token, 'getFile', { file_id: pinned.document.file_id });
      if (!fileInfo.ok) {
        return res.status(400).json({ success: false, error: fileInfo.description });
      }
      
      const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
      https.get(downloadUrl, (fileRes) => {
        let fileData = '';
        fileRes.on('data', chunk => { fileData += chunk; });
        fileRes.on('end', () => {
          try {
            res.status(200).json(JSON.parse(fileData));
          } catch (e) {
            res.status(500).json({ success: false, error: 'Failed to parse database' });
          }
        });
      }).on('error', (err) => {
        res.status(500).json({ success: false, error: err.message });
      });
      
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else if (req.method === 'POST') {
    try {
      const dbContent = JSON.stringify(req.body, null, 2);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      const payloadHeader = 
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${chatId}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="db.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`;
      
      const payloadFooter = `\r\n--${boundary}--`;
      
      const headerBuffer = Buffer.from(payloadHeader, 'utf-8');
      const contentBuffer = Buffer.from(dbContent, 'utf-8');
      const footerBuffer = Buffer.from(payloadFooter, 'utf-8');
      
      const totalPayload = Buffer.concat([headerBuffer, contentBuffer, footerBuffer]);
      
      const sendUrl = `https://api.telegram.org/bot${token}/sendDocument`;
      const reqOptions = {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalPayload.length
        }
      };
      
      const tReq = https.request(sendUrl, reqOptions, (tRes) => {
        let responseData = '';
        tRes.on('data', chunk => { responseData += chunk; });
        tRes.on('end', async () => {
          try {
            const result = JSON.parse(responseData);
            if (!result.ok) {
              return res.status(400).json({ success: false, error: result.description });
            }
            
            const messageId = result.result.message_id;
            await telRequest(token, 'pinChatMessage', {
              chat_id: chatId,
              message_id: messageId,
              disable_notification: true
            });
            
            res.status(200).json({ success: true });
          } catch (e) {
            res.status(500).json({ success: false, error: e.message });
          }
        });
      });
      
      tReq.on('error', (e) => {
        res.status(500).json({ success: false, error: e.message });
      });
      
      tReq.write(totalPayload);
      tReq.end();
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else {
    res.status(405).json({ success: false, error: 'Method not allowed' });
  }
};
