const mongoose=require('mongoose');

const { Schema } =mongoose

const ClientLog = new Schema({
    YMD: {
        type:String,
        required:true,
    },
    time:{
        type:String,
        required:true,
    },
    status:{
        type:String,
        required:true,
    },
    level:{
        type:String,
        required:true,
    },
    pushCnt:{
        type:Number,
        default:0,
    },
})

module.exports=mongoose.model('ClientLog',ClientLog);
/*
* Schema를 생성하기 위한 변수를 mongoose 모듈로 부터 import해줌. const { Schema }
YMD : 년월일 저장 필수값 -> String형
time : 시간 저장 시,분,초 -> String형
status : 발생한 이벤트를(녹화 시장, 종료 등) 저장함 -> String형
level : 발생한 이벤트의 작동 상태를 저장함 (정상, 비정상) -> String형
pushCnt : 침입감지 이벤트를 Chart.js를 이용하여 표로 보여주기 위한 변수, 오직 침입감지 이벤트일 때만 1로 저장. -> String형*/ 