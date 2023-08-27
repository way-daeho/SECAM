const express = require("express");
const path = require('path');
const app=express();
const server = require("http").Server(app);
var io = require("socket.io")(server);
const axios = require("axios");
const querystring = require("querystring");
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const currentTime = new Date();
const YMD = currentTime.toISOString().substr(0, 10);
const time = currentTime.toLocaleTimeString("en-US", { hour12: false });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

const connect = require('./log/connect');
const ClientLog = require('./log/ClientLog');
connect();

app.use(express.static(path.join(__dirname,'public')));
app.use(express.static(path.join(__dirname,'static')));

app.get("/", (req, res) => {
  res.render("index", { IMAGE_STREAM_URL });
});

// 각 Evenet 발생 시, 해당 이벤트에 맞는 값을 넣어주는 코드
app.post("/addLog", async (req, res, next) => {
    const newClientLog = new ClientLog({
      YMD:YMD,
      time:time,
      status: req.body.status,
      level: req.body.level,
    });

    await newClientLog.save();

    res.status(200).json({message: 'Client Log is saved.'});
});


// 여기 까지가 데이터 베이스에 값 넣어주는 코드

// Client Side에선 기술적 Error를 볼 필요가 없기 때문에 Client Log Front로 전달 할 코드 작성

// 선택한 날짜의 로그를 조회하는 엔드포인트
app.get('/viewLogs', (req, res) => {
    res.render('./views/index.ejs');
  });
  
  app.get('/getLogs', async (req, res) => {
    const selectedDate = req.query.selectedDate;
    try {
      const logs = await ClientLog.find({ YMD: selectedDate }).exec();
      res.json(logs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error retrieving logs' });
    }
  });

const CamIP = '192.168.0.150';
const IMAGE_STREAM_URL = `http://${CamIP}`;
const servoUrl = `http://${CamIP}/servo`;
const resetUrl = `http://${CamIP}/reset`;
const servoLogUrl=`http://localhost:3000/servoLog`;
let servo1Angle = 90; 
let servo2Angle = 90;

async function controlServo1() {
  try {
    let data1 = querystring.stringify({ servo1:servo1Angle });
    await axios.post(servoUrl, data1, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
      .then(response => {
        console.log('요청이 성공적으로 처리되었습니다.', response.data);
      })
      .catch(error => {
        console.error('요청 실패:', error.message);
      });

    console.log('서보모터 제어 요청을 보냈습니다.');
  } catch (error) {
    //console.error('서보모터 제어 요청 실패:', error.message);
  }
}

async function controlServo2() {
  try {
    let data2 = querystring.stringify({ servo2:servo2Angle });
    await axios.post(servoUrl, data2, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
   .then(response => {
     console.log('요청이 성공적으로 처리되었습니다.', response.data);
   })
   .catch(error => {
     console.error('요청 실패:', error.message);
   });

    console.log('서보모터 제어 요청을 보냈습니다.');
  } catch (error) {
    console.error('서보모터 제어 요청 실패:', error.message);
  }
}

async function reset() {
  try {
    await axios.get(resetUrl)
      .then(response => {
        console.log('요청이 성공적으로 처리되었습니다.', response.data);
      })
      .catch(error => {
        console.error('요청 실패:', error.message);
      });

    console.log('초기화 요청을 보냈습니다.');
  } catch (error) {
    //console.error('초기화 요청 실패:', error.message);
  }
}

io.on('connection', function(socket) {
  console.log('client connected');
  controlServo1();
  controlServo2();

  socket.on('camara_u', function () {
    servo1Angle += 10;
    controlServo1();
  })

  socket.on('camara_d', function () {
    servo1Angle -= 10;
    controlServo1();
  })

  socket.on('camara_l', function () {
    servo2Angle += 10;
    controlServo2();
  })

  socket.on('camara_r', function () {
    servo2Angle -= 10;
    controlServo2();
  })

  socket.on('reset', function () {
    reset();
  })

  socket.on('disconnect', function() {
    console.log('client disconnected');
  });
});

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
  res.render('index', { IMAGE_STREAM_URL });
});

function cleanDateFormat(dateString) {
  return dateString.replace(/[,\s]/g, ''); // 모든 ','와 공백을 없애는 정규표현식 사용
}

function formatDate(dateString) {
  const [month, day, year] = dateString.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

app.get('/getPushCntData', async (req, res) => {
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  const cleanStartDate = cleanDateFormat(startDate);
  const cleanEndDate = cleanDateFormat(endDate);

  const formattedStartDate = formatDate(cleanStartDate);
  const formattedEndDate = formatDate(cleanEndDate);

  try {
    const logs = await ClientLog.find({ YMD: { $gte: formattedStartDate, $lte: formattedEndDate }, status: "침입 감지" }).exec();

    // Generate the date range from startDate to endDate
    const dateRange = generateDateRange(new Date(formattedStartDate), new Date(formattedEndDate));

    // Create an object to store intrusion counts
    const intrusionCounts = {};

    // Initialize the object with counts of 0 for each date
    dateRange.forEach(date => {
      const dateString = date.toISOString().substr(0, 10);
      intrusionCounts[dateString] = 0;
    });

    // Update the counts for dates with actual intrusion logs
    logs.forEach(log => {
      const dateKey = log.YMD;
      intrusionCounts[dateKey]++;
    });

    // Extract counts only and send as JSON response
    const countsArray = Object.values(intrusionCounts);
    res.json(countsArray);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function generateDateRange(startDate, endDate) {
  const dateRange = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dateRange.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dateRange;
}

server.listen(3000);
