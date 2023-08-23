const mongoose = require('mongoose');

const connect = () => {
  mongoose.connect('mongodb://dbid:dbpw@localhost:27017/admin', {
    dbName: 'SECAM',
    useNewUrlParser: true,
  }).then(() => {
    console.log("몽고디비 연결 성공");
  }).catch((err) => {
    console.error("몽고디비 연결 에러", err);
    // 여기서 추가 작업을 수행할 수 있습니다.
  });
};

mongoose.connection.on('error', (error) => {
  console.error('몽고디비 연결 에러', error);
  // 여기서 추가 작업을 수행할 수 있습니다.
});

mongoose.connection.on('disconnected', () => {
  console.error('몽고디비 연결이 끊겼습니다. 연결을 재시도합니다.');
  connect();
});

module.exports = connect;

/* 코드 설명
  const mongoose = require('mongoose') 
  mongoose를 쓰기 위해 모듈 'mongoose'를 상수형 변수 Mongoose에 선언
  const connect함수 => 함수과 실행되면, callback함수를 호출한다. mongoose.connect를 사용하여, 입력한 DB아이디와 PW, 그리고 포트번호
  와 사용자의 계정 직위를 입력을 입력하면 해당 계정에 연결을 한다, 그 이후 dbName은 SECAM에 연결하는 함수이다. 연결이 잘 되었다면 then()함수 호출,
  에러 발생 시, 몽고디비 연결 에러 메세지와 발생한 에러를 출력해준다.
  해당 모듈을 app.js에서 사용하기 위해 module.exports를 이용하여 app.js에서 connect라는 함수로 사용할 수 있게 한다.*/