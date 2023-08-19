const express = require('express');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/generate', (req, res) => {
  const ssid = req.body.ssid;
  const password = req.body.password;

  const wifiData = {
    ssid: ssid,
    password: password,
    type: 'WPA', // 암호화 유형 (WPA, WEP, 또는 없음)
  };

  const wifiString = JSON.stringify(wifiData);

  qrcode.toDataURL(wifiString, (err, url) => {
    if (err) {
      res.send('QR 코드 생성 중 오류가 발생했습니다.');
    } else {
      res.send(`<img src="${url}" alt="Wi-Fi QR Code"/>`);
    }
  });
});

app.listen(port, () => {
  console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});