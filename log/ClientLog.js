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
