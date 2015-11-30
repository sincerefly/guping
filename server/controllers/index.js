var mongo = require('mongodb');
var monk = require('monk');
var db = monk('localhost:27017/guping');
var request = require('request');
var async = require('async');
var MongoClient = require('mongodb').MongoClient

dbpath='mongodb://localhost:27017/guping';

/* 获取数据 */
exports.getData = function (req, res) {

  if (req.params.user) {
    console.log(req.params.user);
    finder = {"author": req.params.user};
  } else {
    finder = {};
  }

  var collection = db.get('onObservation');
  var collection2 = db.get('onObservationplus');
  collection.find(finder, {}, function (e, docs) {

    var newdata = [];
    for (var i=0; i<docs.length; i++) {

      /* 计算股票和沪深300涨幅 */
      code_up = (docs[i].codePriceEnd - docs[i].codePriceStart) / docs[i].codePriceStart;
      code_up_string = (code_up * 100).toFixed(2).toString() + "%";

      sh300_up = (docs[i].sh300End - docs[i].sh300Start) / docs[i].sh300Start;
      sh300_up_string = (sh300_up * 100).toFixed(2).toString() + "%";

      relative_up = ((code_up - sh300_up) * 100).toFixed(2)
      relative_up_string = relative_up.toString() + "%";

      /* 获取当前得日期 如2015-11-11*/
      date = new Date();
      Ymd = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();

      /* 求得持股天数 */
      sDate= docs[i].startDate;
      eDate= docs[i].ifsell === 1 ? docs[i].endDate : Ymd;
      sArr = sDate.split("-");
      eArr = eDate.split("-");
      sRDate = new Date(sArr[0], sArr[1], sArr[2]);
      eRDate = new Date(eArr[0], eArr[1], eArr[2]);
      hold_days = (eRDate-sRDate)/(24*60*60*1000);

      /* 重组返回得数据 */
      one = {
        "code": docs[i].code,
        "name": docs[i].name,
        "author": docs[i].author,
        "startDate": docs[i].startDate,
        "endDate": eDate,
        "codePriceStart": parseFloat(docs[i].codePriceStart),
        "codePriceEnd": parseFloat(docs[i].codePriceEnd),
        "code_up": code_up_string,
        "sh300Start": parseFloat(docs[i].sh300Start),
        "sh300End": parseFloat(docs[i].sh300End),
        "sh300_up": sh300_up_string,
        "relative_up": parseFloat(relative_up),
        "relative_up_string": relative_up_string,
        "hold_days": hold_days,
        "ifsell": docs[i].ifsell
      }

      newdata.push(one);
    }
    console.log('Get data success');

    // 这里为了方便把想尽的信息存储在了onObservationplus中
    // 以便统计排序等操作
    collection2.remove({}, function () {
      collection2.insert(newdata, function (err, result) {
        console.log('Insert to onObservationplus');
        return res.jsonp(newdata);
      });
    });
  });
}

/* 获取指定用户的数据 */
exports.getUserData = function () {

}


/* 添加数据 */
exports.add = function (req, res) {

  console.log(req.body.code);
  console.log(req.body.name);

  json = {
    code: req.body.code,
    name: req.body.name,
    author: req.body.author,
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    codePriceStart: parseFloat(req.body.codePriceStart),
    codePriceEnd: parseFloat(req.body.codePriceEnd),
    sh300Start: parseFloat(req.body.sh300Start),
    sh300End: parseFloat(req.body.sh300End),
    ifsell: 0
  }

  var collection = db.get('onObservation');
  collection.insert(json, function (e, docs) {});

}


/* 更新数据 */
exports.update = function (req, res) {

  //url = 'http://nuff.eastmoney.com/EM_Finance2015TradeInterface/JS.ashx?id=0006812';
  sh300_url = 'http://nufm2.dfcfw.com/EM_Finance2014NumericApplication/JS.aspx?type=CT&cmd=0003001&&sty=AMIC&st=z&sr=1&p=1&ps=1000&cb=&js=callbacksh300&token=beb0a0047196124721f56b0f0ff5a27c'

  // 获取待更新的股票列表
  MongoClient.connect(dbpath, function (err, db) {
    var collection = db.collection('onObservation');

    collection.find({"ifsell": {"$eq": 0}}, {"code": 1, "_id": 0}).toArray(function (err, docs) {

      // 构造股票代码列表
      var code_list = [];
      for (i in docs) {
        code_list.push(docs[i]['code']);
      }
      console.log("need update: " + code_list);

      // 更新个股及沪深300数据
      async.parallel([
        // 负责个股更新
        function (callback) {
          async.each(code_list, function (code, callback) {
            flag = code[0] === '6' ? '1' : '2';

            // 拼接接口地址
            url = 'http://nuff.eastmoney.com/EM_Finance2015TradeInterface/JS.ashx?id=' + code + flag;

            // 请求个股数据
            request(url, function (err, response, data) {
              if (!err && response.statusCode == 200) {
                var jsonpData = data;
                var startPos = jsonpData.indexOf('({');
                var endPos = jsonpData.indexOf('})');
                var jsonString = jsonpData.substring(startPos+1, endPos+1);
                json = JSON.parse(jsonString);

                codePriceEnd = parseFloat(json['Value'][25]); // 当前价
              }
              else {
                console.log(err);
              }

              // 更新数据
              collection.updateOne({"code": code}, {$set: {"codePriceEnd": codePriceEnd}});
              callback();
            });

          }, function (err) {
            console.log('> code done');
            callback(null, 'codes update');
          });
        },
        // 负责沪深300指数更新
        function (callback) {

          request(sh300_url, function (err, response, data) {
            if (!err && response.statusCode == 200) {
              var startPos = data.indexOf('([');
              var endPos = data.indexOf('])');
              var string = data.substring(startPos+3, endPos-1);
              var list = string.split(',');
              console.log(list[2]);
              sh300End = parseFloat(list[2]);
            }
            else {
              console.log(err);
            }

            // 更新数据
            collection.updateOne({"ifsell": {"$eq": 0}}, {$set: {"sh300End": sh300End}}, {multi: true});
            console.log('> sh300 done');

            callback(null, 'sh300 update');
          });
        },
      ], function (err, result) {
        console.log(result);
        db.close();
        return res.jsonp({'status': true, 'message': 'update success'});
      });
    });
  });
}


/* 卖出 */
exports.sell = function (req, res) {

  code = req.body.code;
  author = req.body.author;
  codePriceEnd = req.body.codePriceEnd;
  sh300End = req.body.sh300End;
  startDate = req.body.startDate;

  console.log(code);
  console.log(author);
  console.log(codePriceEnd);
  console.log(sh300End);
  console.log(startDate);

  /* 获取当前得日期 如2015-11-11*/
  date = new Date();
  Ymd = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();

  /* 求得持股天数 */
  sDate= startDate;
  eDate= Ymd;
  sArr = sDate.split("-");
  eArr = eDate.split("-");
  sRDate = new Date(sArr[0], sArr[1], sArr[2]);
  eRDate = new Date(eArr[0], eArr[1], eArr[2]);
  hold_days = (eRDate-sRDate)/(24*60*60*1000);

  /* 待更新的数据 */
  json = {
    "sh300End": sh300End,
    "codePriceEnd": codePriceEnd,
    "endDate": Ymd,
    "hold_days": hold_days,
    "ifsell": 1
  }

  /* 写入数据库 */
  MongoClient.connect(dbpath, function (err, db) {
    var collection = db.collection('onObservation');
    collection.update({"code": code, "author": author}, {$set: json}, function (e, docs) {
      console.log('sell: ' + code);
    });
    db.close();
  });
};


/* 排名 */
exports.ranklist = function (req, res) {


  /* 利用mongodb的aggregate聚合得出结果 */
  MongoClient.connect(dbpath, function (err, db) {
    var collection = db.collection('onObservationplus');

    collection.aggregate([
      {$group: {_id: "$author", avg: {$avg: "$relative_up"}}},
      {$sort: {avg: -1}}
    ], function (err, result) {

      // 重新组合返回数据
      resu = []
      for (var i in result) {
        one = {
          "author": result[i]._id,
          "avg": (result[i].avg).toFixed(2).toString() + '%'
        }
        resu.push(one);
      }
      console.log(resu)

      db.close();

      return res.jsonp(resu);
    });

  });

}












