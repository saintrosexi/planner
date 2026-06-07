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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const token = req.query.token;
  const code = req.query.code;
  
  if (!token || !code) {
    return res.status(400).json({ success: false, error: 'Missing token or code' });
  }
  
  try {
    const updates = await telRequest(token, 'getUpdates', { limit: 100 });
    if (!updates.ok) {
      return res.status(400).json({ success: false, error: updates.description });
    }
    
    for (const update of updates.result) {
      const msg = update.message || update.edited_message;
      if (msg && msg.text) {
        let textVal = msg.text.trim();
        if (textVal.startsWith('/start ')) {
          textVal = textVal.replace('/start ', '').trim();
        }
        
        if (textVal === code.trim()) {
          return res.status(200).json({
            success: true,
            chatId: msg.chat.id,
            username: msg.from.username || msg.from.first_name || 'User'
          });
        }
      }
    }
    
    res.status(200).json({ success: false, error: 'Code not found yet' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
