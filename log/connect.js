const mongoose = require('mongoose');

const connect = () => {
  mongoose.connect('mongodb://DB id:DB pw@localhost:27017/admin', {
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
