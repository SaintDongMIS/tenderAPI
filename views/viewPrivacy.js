'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const vision = require('@hapi/vision')
const handlebars = require('handlebars')
const Pack = require('../package.json');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'vprivacy',
  version: '1.0.0',
  register: async function (server, options) {

    await server.register({
      plugin: vision,
      options: {
        engines:{ html:handlebars },
        relativeTo: __dirname,
        path: './templates',
        partialsPath: './templates/partials',
        isCached: false //每次都重新進行編譯，建議使用在開發站
      }
    })

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/privacy',
      options: {
        description: 'view - privacy policy',
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
      },
      handler: {
        view:{
          template: 'privacy',
          context: {
            title:'會員權益條款', 
            message:'歡迎您使用本服務，請詳細閱讀以下之條款，本條款訂立的目的，是為了保護本公司會員的利益，並作為本公司與會員間會員服務提供權利義務關係之依據，當您完成相關基本資料(含姓名、聯絡電話、地址、出生日期、性別等資料)之提供進入APP，即正式成為本公司會員，並於開始使用本公司所提供之會員服務時，即視為已知悉及完全同意本條款的所有約定：',
            rules: {
              title:'會員服務與權利義務',
              list:[
                '本服務（後稱 本APP) 不負責任任何因使用而引致之損失，且不會做出任何默認之擔保，請使用者自行承擔一切風險',
                '本APP承諾力求內容之正確性及完整性，若內容有錯誤或遺漏將不承擔任何賠償之責任',
                '本APP會隨時更新版本，不另作通知',
                '本APP可隨時停止或變更使用者條款，不另作通知',
                '本APP不對使用後所引致之毀謗、任何損害(包括但不限於電腦病毒、系統故障、資料損失)、侵犯版權或知識財產所造成之損失(包括但不限於利潤、商譽、使用、資料損失或其他無形損失)不承擔任何直接、間接、附帶、特別、衍生性或懲罰性賠償',
                '本APP可能會連接至其他相關網頁，但不會對這些網頁內容做任何保證或承擔任何責任，使用者若瀏覽這些網頁需自行承擔風險',
                '透過本APP下載或取得任何資料，應由使用者自行考慮且自負風險，若因前開下載之任何資料導致使用者電腦系統之任何損壞或資料流失，本APP開發者不負擔任何責任'
             ],
            },
            stopService: {
              title:'終止會員服務',
              list:[
                '基於公司的運作，本公司得無條件停止提供服務之全部或一部，會員不可以因此而要求任何賠償或補償。',
                '會員如違反了本條款，本公司得暫時停止向會員提供服務、或終止會員之權利，會員不可以因此而要求任何賠償或補償。'
              ]
            }
            
          }
        }
      }
    });
    /* Router End */   
  },
};
