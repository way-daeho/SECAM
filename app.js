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
      pushCnt:0
    });

    if(newClientLog.status==="침입 감지"){
      ClientLog.pushCnt=1;
    }

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

app.get('/getPushCntData', async (req, res) => {
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  try {
    const pushCntData = await ClientLog.aggregate([
      {
        $match: {
          YMD: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalPushCnt: { $sum: '$pushCnt' }
        }
      }
    ]);

    const totalPushCnt = pushCntData.length > 0 ? pushCntData[0].totalPushCnt : 0;

    res.json([{ totalPushCnt }]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

server.listen(3000);