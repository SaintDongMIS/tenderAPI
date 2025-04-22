'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");
const { parse } = require('path');
const { URL } = require('url');
const tools = require('../../utils/tools');

const authStrategy = false;
//const authStrategy = 'simple';

const sql = require('mssql');
const snLimit = 4868469; // 2022/5/1之後的案件

const sqlConfig_1 = {
	user: process.env.MSSQL_USER,
	password: process.env.MSSQL_PWD,
	database: 'rm100',
	requestTimeout: 40000,
	server: process.env.MSSQL_HOST,
	pool: {
		max: 10,
		min: 0,
		idleTimeoutMillis: 30000
	},
	options: {
		cryptoCredentialsDetails: {
			minVersion: 'TLSv1',
		},
		trustServerCertificate: true
	}
}

// 替換面積公式Formula Map
const replaceFormulaMap = {
	" ": "", "m2": "", "M2": "", "m": "", "M": "", "＋": "+", "－": "-", "＊": "*", "x": "*", "X": "*", "×": "*", "／": "/", "（": "(", "）": ")",
	"０": '0', "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9"
};
// const regexFormula = new RegExp('^[0-9*+\/().-]+$', 'g');
const regexFormula = /^[^*+/-](?:[*+/\-]?[(]*\d+\.?\d*[)]*)+$/g;

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'dispatch',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		// 案件匯入(MSSQL_rm100 tbl_case)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/caseImport',
			options: {
				description: 'tbl_case案件匯入',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						// deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { timeStart, timeEnd } = request.query;
				const deviceTypeMap = { 1: '道路', 2: '熱再生', 3: '設施', 4: '標線' };
				let response = [];
				console.time("caseImport");
				console.log(`------------ 匯入案件: ${timeStart} ~ ${timeEnd} ------------ `);

				// NOTE: 因目前無標線案件，先不匯入標線
				// 目前只鎖定「中山區成效式契約」 DTeam = 91
				// for(const deviceType of [ 1, 2, 3, 4 ]) {
				for(const deviceType of [ 1, 2, 3 ]) {
					console.log(`--- 類型: ${deviceTypeMap[deviceType]} ---`);

					// 讀取tbl_case(rm100)
					let sqlCMD_dType = "";
					switch (deviceType) {
						case 1: // 道路
							sqlCMD_dType =
								` AND caseList.roadtype = '1'
								AND caseList.recoverflag = '0'
								AND caseList.casesn <> '0'
								AND ( caseList.paperflag= '1' OR ( caseList.paperflag = '0' AND caseList.casetype= '5' ) ) 
								AND caseList.devicetype <> '5' 
								AND caseList.paperkind IN ( '1', '2', '3', '5' ) 
								AND caseList.btype NOT IN ( '20', '23' )  `;
							break;
						case 2:	// 熱再生
							sqlCMD_dType =
								` AND caseList.roadtype = '1'
								AND caseList.recoverflag = '2'
								AND caseList.casesn <> '0' 
								AND ( caseList.paperflag= '1' OR ( caseList.paperflag = '0' AND caseList.casetype= '5' ) ) 
								AND caseList.devicetype <> '5' 
								AND caseList.paperkind IN ( '1', '2', '3', '5', '7' ) 
								AND caseList.btype NOT IN ( '20', '23' )  `;
							break;
						case 3:	// 設施
							sqlCMD_dType =
								` AND caseList.roadtype IN (2, 3)
								AND caseList.recoverflag = '0'
								AND ( ( caseList.paperflag = '1' ) OR ( caseList.btype = '20' AND caseList.paperflag = '0' ) )  `;
							break;
						case 4:	// 標線
							sqlCMD_dType =
								` AND caseList.roadtype IN (2, 3)
								AND caseList.devicetype = '4'
								AND caseList.recoverflag = '0'
								AND caseList.casesn <> '0' 
								AND ( caseList.paperflag= '1' OR ( caseList.paperflag = '0' AND caseList.casetype= '5' ) ) `;
							break;
					}

					await sql.connect(sqlConfig_1);

					const { recordsets: [ res_case ] } = await sql.query(
						`SELECT DISTINCT
							caseList.SerialNo,
							caseList.CaseSN,
							caseList.CaseNo,
							caseList.succ AS CaseSucc,
							caseList.CaseType,
							caseList.bsn AS BlockSN,
							caseList.XX AS CoordinateX,
							caseList.YY AS CoordinateY,
							caseList.CaseName AS Place,
							caseList.lining AS Postal_vil,
							caseList.RoadType,
							caseList.BType AS DistressType,
							caseList.BrokeType AS DistressLevel,
							caseList.DeviceType,
							caseList.CaseDate AS DateCreate,
							caseList.acrendate AS DateDeadline,
							caseList.PicPath1 AS ImgZoomIn,
							caseList.PicPath3 AS ImgZoomOut,
							caseList.delmuch0 AS MillingDepth,
							caseList.elength0 AS MillingLength,
							caseList.blength0 AS MillingWidth,
							caseList.account0 AS MillingFormula,
							caseList.acsum0 AS MillingArea,
							caseList.c5type AS Notes,
							caseList.recoverflag
						FROM
							tbl_case AS caseList
						WHERE
							caseList.SerialNo >= ${snLimit}
							AND caseList.reccontrol= '1' 
							AND caseList.casetype <> '5'
							AND caseList.recaseno = caseList.caseno 
							AND caseList.BSN IN (SELECT SerialNo FROM tbl_block WHERE dteam IN ('91', '81', '71', '72')) 
							${sqlCMD_dType}
							AND CAST ( caseList.CaseDate AS datetime ) >= '${timeStart}' AND CAST ( caseList.CaseDate AS datetime ) < '${timeEnd}'
						ORDER BY caseList.casename`
					);

					sql.close();
					response.push(res_case);
					console.log(`件數: ${res_case.length}`);
					if (res_case.length > 0) console.log(`SN: ${res_case.map(caseSpec => caseSpec.SerialNo).join("、") || 0 }`);

					// 寫入caseDistress
					// State = 3
					// RestoredType: 1 AC / 2 HR
					// ImgZoomIn, ImgZoomOut 上傳至GCP並取代
					for (const caseSpec of res_case) {
						console.log(`--- tbl_case SerialNo: ${caseSpec.SerialNo} 開始 ---`);
						console.log(caseSpec);

						let columnArr = [
							'SerialNo', 'CaseSN', 'CaseNo', 'CaseSucc', 'CaseType', 'BlockSN', 'State', 'CoordinateX', 'CoordinateY',
							'Place', 'Postal_vil', 'RoadType', 'DistressType', 'DistressLevel', 'DeviceType', 'RestoredType',
							'DateCreate', 'DateDeadline', 'ImgZoomIn', 'ImgZoomOut', 'MillingDepth', 'MillingLength',
							'MillingWidth', 'MillingFormula', 'MillingArea', 'Notes'
						];

						caseSpec.State = 3;
						if (deviceType == 4) columnArr = columnArr.filter(col => col != 'RestoredType');
						else caseSpec.RestoredType = ([1, 2].includes(deviceType)) ? deviceType : 0;
						if (!caseSpec.DateDeadline || caseSpec.DateDeadline == '0') columnArr = columnArr.filter(col => col != 'DateDeadline');
						if (!caseSpec.Notes) columnArr = columnArr.filter(col => col != 'Notes');
						if (!caseSpec.MillingFormula || caseSpec.MillingFormula.length == 0) {
							columnArr = columnArr.filter(col => col != 'MillingFormula');
							caseSpec.MillingArea = Math.round(caseSpec.MillingLength * caseSpec.MillingWidth * 100) / 100;
						} else {
							for (const key in replaceFormulaMap) caseSpec.MillingFormula = caseSpec.MillingFormula.replace(new RegExp(key, 'g'), replaceFormulaMap[key]);
							caseSpec.MillingArea = regexFormula.test(caseSpec.MillingFormula) ? Math.round(new Function(`return ${caseSpec.MillingFormula}`)() * 100) / 100 : 0;
						}

						// 照片上傳至GCP
						for (const imgKey of ['ImgZoomIn', 'ImgZoomOut']) {
							const destFileName = `tbl_case_image/${caseSpec.SerialNo}_${imgKey}`;
							await server.methods.getFileList(destFileName).then(async (existFileList) => {
								const imgUrl = new URL(`https:/rm.bim-group.com/pic/${caseSpec[imgKey]}`);
								const pathname = imgUrl.pathname;
								const url = imgUrl.href;
								const { ext } = parse(pathname);
								const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;
								
								await server.methods.uploadFileUrl(url, destFileNameSpec)
									.then(publicUrl => caseSpec[imgKey] = decodeURIComponent(publicUrl))
									.catch(err => console.log(err));
							}).catch(err => console.log(err));
						}

						const caseDistressColStr = columnArr.join(",");
						const caseDistressValStr = columnArr.map(col => {
							const val = (caseSpec[col] || caseSpec[col] == 0) ? caseSpec[col] : '';
							return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
						}).join(",");
						const caseDistressUpdateStr = columnArr.filter(col => !["SerialNo", "State"].includes(col)).map(col => {
							const val = (caseSpec[col] || caseSpec[col] == 0) ? caseSpec[col] : '';
							return (val instanceof String || (typeof val).toLowerCase() == 'string')
								? `${col} = '${val}'` : `${col} = ${val}`;
						}).join(",");

						// console.log(caseDistressColStr);
						// console.log(caseDistressValStr);
						// console.log(caseDistressUpdateStr);

						await request.tendersql.pool.execute(
							`INSERT INTO caseDistress ( ${caseDistressColStr}, Coordinate) VALUES ( ${caseDistressValStr}, ST_GeomFromText('POINT(${caseSpec.CoordinateX} ${caseSpec.CoordinateY})'))
							ON DUPLICATE KEY UPDATE ${caseDistressUpdateStr}, DateUpdate_At = NOW()`
						);

						// 寫入標線
						// if (deviceType == 4) {
						// 	let sqlCMD_restoreTable = "";
						// 	let restoredColArr = ["SerialNo"];
						// 	if (caseSpec.RoadType == '1' && caseSpec.recoverflag == '0') {
						// 		sqlCMD_restoreTable = "caseRestoredAC";
						// 		restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						// 	} else if (caseSpec.RoadType == '1' && caseSpec.recoverflag == '2') {
						// 		sqlCMD_restoreTable = "caseRestoredHR";
						// 		restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						// 	} else if (['2', '3'].includes(caseSpec.RoadType) && caseSpec.recoverflag == '0') {
						// 		sqlCMD_restoreTable = "caseRestoredFA";
						// 		restoredColArr.push("Notes");
						// 	}
						// 	if (!caseSpec.MillingFormula || caseSpec.MillingFormula.length == 0) restoredColArr = restoredColArr.filter(col => col != 'MillingFormula');
						// 	if (!caseSpec.Notes) restoredColArr = restoredColArr.filter(col => col != 'Notes');

						// 	// 確認是否已建立「補繪標線」派工
						// 	const [ res_caseSpec ] = await request.tendersql.pool.execute(
						// 		`SELECT
						// 		${sqlCMD_restoreTable}.caseSID,
						// 		caseRestoredMK.OrderSN
						// 	FROM
						// 		${sqlCMD_restoreTable}
						// 		LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = ${sqlCMD_restoreTable}.caseSID AND caseRestoredMK.IsActive = 1 
						// 	WHERE
						// 		${sqlCMD_restoreTable}.caseSID = ?
						// 		AND ${sqlCMD_restoreTable}.IsActive = 1
						// 		AND caseRestoredMK.OrderSN IS NOT NULL`,
						// 		[ caseSpec.SerialNo ]
						// 	)
						// 	if (res_caseSpec.length > 0) continue;

						// 	await request.tendersql.pool.execute(
						// 		`INSERT INTO caseRestoredMK (caseSID) VALUES (?)`,
						// 		[ caseSpec.SerialNo ]
						// 	)

						// 	const restoredColStr = restoredColArr.map(col => (col == "SerialNo" ? "caseSID" : col)).join(",");
						// 	const restoredValStr = restoredColArr.map(col => {
						// 		return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') 
						// 			? `'${caseSpec[col]}'` : `${caseSpec[col]}`;
						// 	}).join(",");

						// 	// console.log(restoredColStr);
						// 	// console.log(restoredValStr);

						// 	await request.tendersql.pool.execute(
						// 		`INSERT INTO ${sqlCMD_restoreTable} (${restoredColStr}, IsMarking) VALUES (${restoredValStr}, 1)`
						// 	);
						// }

						console.log(`--- tbl_case SerialNo: ${caseSpec.SerialNo} 結束 ---\n`);
					}
				}

				console.timeEnd("caseImport");

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: response }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/orderImport',
			options: {
				description: 'tbl_case派工單匯入',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						// deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						dispatchSN: Joi.string().required().description("派工單號"),
						// timeStart: Joi.string().required().description('起始時間'),
						// timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dispatchSN } = request.query;
				// const deviceTypeMap = { 1: '道路', 2: '熱再生', 3: '設施', 4: '標線' };
				let deviceType = 0;
				if (dispatchSN.toUpperCase().match(/^H\d+$/g)) deviceType = 2;
				else if (dispatchSN.toUpperCase().match(/^W\d+$/g)) deviceType = 3;
				else if (dispatchSN.toUpperCase().match(/^[^A-Z]\d+$/g)) deviceType = 1;

				if (deviceType == 0) return Boom.notAcceptable("Non-Accepted dispatchSN"); 

				// 完工備註Map
				const workmemoMap = {
					1: "uStacker",
					2: "uDigger",
					3: "uNotes",
					4: "uPaver",
					5: "uRoller",
					6: "uSprinkler"
				};

				// 完工登錄照片Map
				const [ res_restoredImg ] = await request.tendersql.pool.execute(`SELECT Id, ImgName, EngName FROM caseRestoredImg`);
				// 施工廠商Map
				const [ res_guild ] = await request.accsql.pool.execute(`SELECT GuildCode, Name FROM guilds WHERE GuildCode > 3000`);

				console.time("orderImport");
				console.log(`------------ 匯入派工單: ${dispatchSN} 開始 ------------ `);

				// 目前只鎖定「中山區成效式契約」 DTeam = 91
				// SELECT tbl_case(rm100)
				let sqlCMD_filter = "";
				let sqlCMD_orderIndexCol = "";
				let sqlCMD_restoreTable = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_orderIndexCol = "CTYPE1ORDER";
						sqlCMD_filter = ` AND caseList.CType1NO = '${dispatchSN}' `;
						break;
					case 2: // 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_orderIndexCol = "ctype4order";
						sqlCMD_filter = ` AND caseList.CType4No = '${dispatchSN}' `;
						break;
					case 3: // 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_orderIndexCol = "CTYPE1ORDER";
						sqlCMD_filter = ` AND caseList.CType1NO = '${dispatchSN}' `;
						break;
				}

				await sql.connect(sqlConfig_1);

				const { recordsets: [ res_case ] } = await sql.query(
					`SELECT DISTINCT
						caseList.SerialNo,
						caseList.CaseSN,
						caseList.CaseNo,
						caseList.succ AS CaseSucc,
						caseList.CaseType,
						caseList.bsn AS BlockSN,
						caseList.XX AS CoordinateX,
						caseList.YY AS CoordinateY,
						caseList.CaseName AS Place,
						caseList.lining AS Postal_vil,
						caseList.RoadType,
						caseList.BType AS DistressType,
						caseList.BrokeType AS DistressLevel,
						caseList.DeviceType,
						caseList.CaseDate AS DateCreate,
						caseList.acrendate AS DateDeadline,
						caseList.PicPath1 AS ImgZoomIn,
						caseList.PicPath3 AS ImgZoomOut,
						caseList.delmuch0 AS MillingDepth,
						caseList.elength0 AS MillingLength,
						caseList.blength0 AS MillingWidth,
						caseList.account0 AS MillingFormula,
						caseList.acsum0 AS MillingArea,
						caseList.c5type AS Notes,
						caseList.recoverflag,
						
						caseList.wcsn0 AS Re_Contractor,
						ROW_NUMBER() OVER (ORDER BY ${sqlCMD_orderIndexCol} ASC) AS Re_OrderIndex,
						caseList.SCType1Flag AS Re_markingFlag,
						caseList.CType0date AS Re_DateCreate_At,
						(CASE WHEN caseList.delmuch = 0 THEN caseList.delmuch0 ELSE caseList.delmuch END) AS Re_MillingDepth,
						(CASE WHEN caseList.elength1 = 0 THEN caseList.elength0 ELSE caseList.elength1 END) AS Re_MillingLength,
						(CASE WHEN caseList.blength1 = 0 THEN caseList.blength0 ELSE caseList.elength1 END) AS Re_MillingWidth,
						(CASE WHEN caseList.account = '0' THEN caseList.account0 ELSE caseList.account END) AS Re_MillingFormula,
						(CASE WHEN caseList.acsum = 0 THEN caseList.acsum0 ELSE caseList.acsum END)  AS Re_MillingArea,
						caseList.workmemo AS Re_workMemo,
						caseList.picpath8 AS Re_uStackerImg1,
						caseList.picpath8_1 AS Re_uStackerImg2,
						caseList.picpath9 AS Re_uDiggerImg1,
						caseList.picpath9_1 AS Re_uDiggerImg2,
						ISNULL(caseList.ins1, 0) AS Re_Aggregate34,
						ISNULL(caseList.ins2, 0) AS Re_Aggregate38,
						caseList.checklai AS Re_SamplingL1,
						caseList.checklaitype AS Re_SamplingL1Type,
						caseList.checklaivalue AS Re_SamplingL1Value,
						caseList.checklaitype1 AS Re_SamplingL1Unit,
						caseList.checklai2 AS Re_SamplingL2,
						caseList.checklai2type AS Re_SamplingL2Type,
						caseList.checklai2value AS Re_SamplingL2Value,
						caseList.checklai2type1 AS Re_SamplingL2Unit,
						caseList.PicPath7 AS Re_UnderConstrImg,
						caseList.PicPath4 AS Re_PostConstrImg
					FROM
						tbl_case AS caseList
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.CType1 = '1' 
						AND caseList.CType2 = '0' 
						AND caseList.reccontrol = '1' 
						AND caseList.BSN IN (SELECT SerialNo FROM tbl_block WHERE dteam IN ('91', '81', '71', '72')) 
						AND caseList.recaseno = caseList.caseno 
						${sqlCMD_filter}`
				);
				// console.log(res_case);
				console.log(`件數: ${res_case.length}`);
				if (res_case.length > 0) console.log(`SN: ${res_case.map(caseSpec => caseSpec.SerialNo).join("、") || 0}`);
				else return Boom.notAcceptable("No Case"); 

				const contractorName = res_case[0].Re_Contractor;

				// SELECT [相片]
				const caseSNListStr = res_case.map(caseSpec => caseSpec.SerialNo).join(",");
				const { recordsets: [ res_photo ] } = await sql.query(
					`SELECT 
						[索引] AS caseSN, 
						[相片名稱] AS imgName, 
						[相片1] AS url1, 
						[相片2] AS url2
					FROM [相片] WHERE [索引] IN (${caseSNListStr})`
				);
				// console.log(res_photo);

				// SELECT [計價組套] [計價組套設計]
				const { recordsets: [ res_task ] } = await sql.query(
					`SELECT
						[計價組套].casecsn AS CaseSID,
						[計價組套].[設計施作數量] AS DesignDetail,
						[計價組套].[設計施工方式] AS DesignDesc,
						[計價組套].[設計施作人力] AS DesignWorker,
						[計價組套設計].[項次] AS UnitSN,
						[計價組套設計].[項次名稱] AS TaskName,
						[計價組套設計].[單位] AS TaskUnit,
						[計價組套設計].[數量] AS TaskNumber,
						[估驗詳細表].[單價] AS TaskPrice,
						[計價組套設計].DTeam
					FROM
						[計價組套]
						INNER JOIN [計價組套設計] ON [計價組套].serialno = [計價組套設計].[組套名稱序號]
						LEFT OUTER JOIN [估驗詳細表] ON [計價組套設計].dteam = [估驗詳細表].dteam AND [計價組套設計].[項次] = [估驗詳細表].[項次] 
					WHERE
						[計價組套設計].reccontrol = '1' 
						AND [計價組套].casecsn IN (${caseSNListStr})
					ORDER BY [計價組套].casecsn, [估驗詳細表].[項次排序]`
				);
				// console.log(res_task);

				sql.close();

				// 寫入caseOrder
				const transAD = Number(dispatchSN.replace(/[^0-9]/g, "").slice(0, 5)) + 191100;
				const yearMonth = DateTime.fromFormat(String(transAD), 'yyyyMM');
				const idRange = [
					Number(yearMonth.toFormat("yyyyMM001")) - 191100000,
					Number(yearMonth.plus({ month: 1 }).toFormat("yyyyMM001")) - 191100000
				];
				// console.log(idRange);

				const [ res_orderId ] = await request.tendersql.pool.execute(
					`SELECT id FROM caseOrder WHERE id >= ? AND id < ? ORDER BY id DESC`,
					[ idRange[0], idRange[1] ]
				);
				// console.log(res_orderId);
				const orderSN = res_orderId.length != 0  ? Number(res_orderId[0].id) + 1 : idRange[0];
				const contractor = res_guild.filter(guild => guild.Name == res_case[0].Re_Contractor)[0].GuildCode;
				// console.log(orderSN);
				await request.tendersql.pool.execute(
					`INSERT INTO caseOrder (id, Contractor, OrderType, Creater) VALUES (?, ?, ?, NULL)`,
					[ orderSN, contractor, deviceType ]
				);

				for (const caseSpec of res_case) {
					console.log(`--- tbl_case SerialNo: ${caseSpec.SerialNo} 開始 ---`);

					let columnArr = [
						'SerialNo', 'CaseSN', 'CaseNo', 'CaseSucc', 'CaseType', 'BlockSN', 'State', 'CoordinateX', 'CoordinateY',
						'Place', 'Postal_vil', 'RoadType', 'DistressType', 'DistressLevel', 'DeviceType', 'RestoredType',
						'DateCreate', 'DateDeadline', 'ImgZoomIn', 'ImgZoomOut', 'MillingDepth', 'MillingLength',
						'MillingWidth', 'MillingFormula', 'MillingArea'
					];
					let columnArr_Restored = [ 'Contractor', 'OrderIndex', 'DateCreate_At', 'PostConstrImg' ];

					switch (deviceType) {
						case 1: // 道路
							caseSpec.RestoredType = deviceType;
							columnArr_Restored.push(
								'MillingDepth', 'MillingLength', 'MillingWidth', 'MillingFormula', 'MillingArea', 'uStacker', 'uStackerImg', 
								'uSprinkler', 'uSprinklerImg', 'uDigger', 'uDiggerImg', 'uRoller', 'uRollerImg', 'uPaver', 'uPaverImg', 'uNotes', 
								'Aggregate34', 'Aggregate38', 'SamplingL1', 'SamplingL1Detail', 'SamplingL2', 'SamplingL2Detail', 'UnderConstrImg');
							break;
						case 2:	// 熱再生
							caseSpec.RestoredType = deviceType;
							columnArr_Restored.push(
								'MillingDepth', 'MillingLength', 'MillingWidth', 'MillingFormula', 'MillingArea', 'uStacker', 'uStackerImg',
								'uSprinkler', 'uSprinklerImg', 'uDigger', 'uDiggerImg', 'uRoller', 'uRollerImg', 'uPaver', 'uPaverImg', 'uNotes', 'UnderConstrImg');
							break;
						case 3:	// 設施
							caseSpec.RestoredType = 0;
							columnArr.push('Notes', 'TaskRealGroup', 'KitNotes');
							columnArr_Restored.push('Notes', 'TaskRealGroup', 'KitNotes', 'Image');
							break;
					}
					
					caseSpec.State = 7;
					if (!caseSpec.DateDeadline || caseSpec.DateDeadline == '0') columnArr = columnArr.filter(col => col != 'DateDeadline');
					if (!caseSpec.Notes) {
						columnArr = columnArr.filter(col => col != 'Notes');
						columnArr_Restored = columnArr_Restored.filter(col => col != 'Notes');
					} else caseSpec.Re_Notes = caseSpec.Notes;

					for (const prefix of ["", "Re_"]) {
						if (!caseSpec[`${prefix}MillingFormula`] || caseSpec[`${prefix}MillingFormula`].length == 0) {
							if (prefix == "") columnArr = columnArr.filter(col => col != `MillingFormula`);
							if (prefix == "Re_") columnArr_Restored = columnArr_Restored.filter(col => col != `MillingFormula`);

							caseSpec[`${prefix}MillingArea`] = Math.round(caseSpec[`${prefix}MillingLength`] * caseSpec[`${prefix}MillingWidth`] * 100) / 100;
						} else {
							for (const key in replaceFormulaMap) caseSpec[`${prefix}MillingFormula`] = caseSpec[`${prefix}MillingFormula`].replace(new RegExp(key, 'g'), replaceFormulaMap[key]);
							caseSpec[`${prefix}MillingArea`] = regexFormula.test(caseSpec.MillingFormula) ? Math.round(new Function(`return ${caseSpec[`${prefix}MillingFormula`]}`)() * 100) / 100 : 0;
						}
					}
					if (caseSpec.Re_Contractor) caseSpec.Re_Contractor = res_guild.filter(guild => guild.Name == caseSpec.Re_Contractor)[0].GuildCode;

					// 完工備註
					Object.values(workmemoMap).forEach(val => {
						caseSpec[`Re_${val}`] = val == 'uNotes' ? '' : 0;
						caseSpec[`Re_${val}Img`] = [];
					});

					if (caseSpec.Re_workMemo != null && caseSpec.Re_workMemo.length > 0) {
						caseSpec.Re_workMemo.split("###").forEach(memo => {
							const [key, value] = memo.split("@@@");
							caseSpec[`Re_${workmemoMap[key]}`] = Number(value);
						});
					}
					delete caseSpec.Re_workMemo;

					// 粒料
					for( const label of ['L1', 'L2']) {
						caseSpec[`Re_Sampling${label}`] = Number(caseSpec[`Re_Sampling${label}`]);
						// console.log(label, caseSpec[`Re_Sampling${label}`]);

						if (caseSpec[`Re_Sampling${label}`]) {
							caseSpec[`Re_Sampling${label}Detail`] = JSON.stringify({
								Aggregate: caseSpec[`Re_Sampling${label}Type`].replace("/", ""),
								Amount: caseSpec[`Re_Sampling${label}Value`],
								Unit: caseSpec[`Re_Sampling${label}Unit`]
							});
						} else caseSpec[`Re_Sampling${label}Detail`] = '[]';
						delete caseSpec[`Re_Sampling${label}Type`];
						delete caseSpec[`Re_Sampling${label}Value`];
						delete caseSpec[`Re_Sampling${label}Unit`];
					}

					// 設施 - 寫入TaskReal
					if (deviceType == 3) {
						const taskFilter = res_task.filter(taskSpec => taskSpec.CaseSID == caseSpec.SerialNo);
						// console.log(taskFilter);
						if (taskFilter.length == 0) {
							columnArr = columnArr.filter(col => !['KitNotes', 'TaskRealGroup'].includes(col));
							columnArr_Restored = columnArr_Restored.filter(col => !['KitNotes', 'TaskRealGroup'].includes(col));
						} else {
							caseSpec.KitNotes = JSON.stringify({
								DesignDetail: taskFilter[0].DesignDetail,
								DesignDesc: taskFilter[0].DesignDesc,
								DesignWorker: taskFilter[0].DesignWorker
							});
							caseSpec.Re_KitNotes = caseSpec.KitNotes;

							const [[ res_lastGroupId ]] = await request.tendersql.pool.execute(
								`SELECT GroupId AS lastGroupId FROM TaskReal ORDER BY GroupId DESC LIMIT 1`
							);
							// console.log(res_lastGroupId);
							caseSpec.TaskRealGroup = res_lastGroupId ? Number(res_lastGroupId.lastGroupId) + 1 : 1;
							caseSpec.Re_TaskRealGroup = caseSpec.TaskRealGroup;

							for (const taskSpec of taskFilter) {
								delete taskSpec.DesignDetail;
								delete taskSpec.DesignDesc;
								delete taskSpec.DesignWorker;

								const taskRealColStr = Object.keys(taskSpec).join(",");
								const taskRealValStr = Object.values(taskSpec).map(val => {
									return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
								}).join(",");

								await request.tendersql.pool.execute(
									`INSERT INTO TaskReal ( GroupId, ${taskRealColStr} ) VALUES ( ?, ${taskRealValStr} )`,
									[ caseSpec.TaskRealGroup ]
								);
							}
						}
					}

					// 照片處理
					caseSpec.Re_UnderConstrImg = caseSpec.Re_UnderConstrImg == '0' ? [] : [ caseSpec.Re_UnderConstrImg ];
					caseSpec.Re_PostConstrImg = caseSpec.Re_PostConstrImg == '0' ? [] : [ caseSpec.Re_PostConstrImg ];
					caseSpec.Re_Image = {}; 
					for (const imgKey of [ 'uStackerImg', 'uDiggerImg' ]) {
						let imgList = [];

						if (caseSpec[`Re_${imgKey}1`].length > 0 && caseSpec[`Re_${imgKey}1`] != '0') imgList.push(caseSpec[`Re_${imgKey}1`]);
						delete caseSpec[`Re_${imgKey}1`];
						if (caseSpec[`Re_${imgKey}2`].length > 0 && caseSpec[`Re_${imgKey}2`] != '0') imgList.push(caseSpec[`Re_${imgKey}2`]);
						delete caseSpec[`Re_${imgKey}2`];

						caseSpec[`Re_${imgKey}`] = imgList;
						if (imgList.length > 0) caseSpec.Re_Image[`Re_${imgKey}`] = caseSpec[`Re_${imgKey}`];
					}

					// 照片匯入
					const photoFilter = res_photo.filter(photoSpec => photoSpec.caseSN == caseSpec.SerialNo);
					for (const photoSpec of photoFilter) {
						const restoredImgSpec = res_restoredImg.filter(imgSpec => imgSpec.ImgName == photoSpec.imgName);
						if (restoredImgSpec.length > 0) {
							let imgList = [];
							
							if (photoSpec.url1.length > 0 && photoSpec.url1 != '0') imgList.push(photoSpec.url1);
							if (photoSpec.url2.length > 0 && photoSpec.url2 != '0') imgList.push(photoSpec.url2);

							caseSpec[`Re_${restoredImgSpec[0].EngName}Img`] = imgList;
							if(imgList.length > 0) caseSpec.Re_Image[`Re_${restoredImgSpec[0].EngName}Img`] = caseSpec[`Re_${restoredImgSpec[0].EngName}Img`];
						}
					}

					// 照片上傳至GCP
					const imgKeyList = Object.keys(caseSpec).filter(key => key.match(/Img$/g));
					for (const imgKey of [ 'ImgZoomIn', 'ImgZoomOut', ...imgKeyList ]) {
						let imgList = [];
						if ([ 'ImgZoomIn', 'ImgZoomOut' ].includes(imgKey)) imgList.push(caseSpec[imgKey]);
						else imgList = caseSpec[imgKey];
						console.log(imgKey, imgList);

						if(imgList.length > 0) {
							const destFileName = `tbl_case_image/${caseSpec.SerialNo}_${imgKey.replace("Re_", "")}`;
							await server.methods.getFileList(destFileName).then(async (existFileList) => {
								for (const [index, file] of imgList.entries()) {
									const imgUrl = new URL(`https:/rm.bim-group.com/pic/${file}`);
									const pathname = imgUrl.pathname;
									const url = imgUrl.href;
									const { ext } = parse(pathname);
									const destFileNameSpec = `${destFileName}_${existFileList.length + index + 1}${ext}`;

									await server.methods.uploadFileUrl(url, destFileNameSpec)
										.then(publicUrl => imgList[index] = decodeURIComponent(publicUrl))
										.catch(err => console.log(err));
								}
							}).catch(err => console.log(err));
						}

						if (['ImgZoomIn', 'ImgZoomOut'].includes(imgKey)) caseSpec[imgKey] = imgList.length > 0 ? imgList[0] : '';
						else {
							caseSpec[imgKey] = JSON.stringify(imgList);
							if(imgList.length > 0) caseSpec.Re_Image[imgKey] = imgList;
						}
					}
					Object.keys(caseSpec.Re_Image).forEach(key => {
						const restoredImgSpec = res_restoredImg.filter(imgSpec => `Re_${imgSpec.EngName}Img` == key);
						console.log(key, restoredImgSpec);
						if (restoredImgSpec.length > 0) caseSpec.Re_Image[restoredImgSpec[0].Id] = caseSpec.Re_Image[key];
						delete caseSpec.Re_Image[key];
					})

					caseSpec.Re_Image = JSON.stringify(caseSpec.Re_Image);
					
					// console.log(caseSpec);

					// 寫入caseDistress
					const caseDistressColStr = columnArr.join(",");
					const caseDistressValStr = columnArr.map(col => {
						const val = (caseSpec[col] || caseSpec[col] == 0) ? caseSpec[col] : '';
						return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
					}).join(",");
					const caseDistressUpdateStr = columnArr.filter(col => col != "SerialNo").map(col => {
						const val = (caseSpec[col] || caseSpec[col] == 0) ? caseSpec[col] : '';
						return (val instanceof String || (typeof val).toLowerCase() == 'string')
							? `${col} = '${val}'` : `${col} = ${val}`;
					}).join(",");

					await request.tendersql.pool.execute(
						`INSERT INTO caseDistress ( ${caseDistressColStr}, Coordinate) VALUES ( ${caseDistressValStr}, ST_GeomFromText('POINT(${caseSpec.CoordinateX} ${caseSpec.CoordinateY})'))
							ON DUPLICATE KEY UPDATE ${caseDistressUpdateStr}, DateUpdate_At = NOW()`
					);

					// 寫入caseRestored
					// disable 之前的案件
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET IsActive = 0 WHERE caseSID = ?`,
						[ caseSpec.SerialNo ]
					);

					const caseRestoredColStr = columnArr_Restored.join(",");
					const caseRestoredValStr = columnArr_Restored.map(col => {
						const val = (caseSpec[`Re_${col}`] || caseSpec[`Re_${col}`] == '0') ? caseSpec[`Re_${col}`] : '';
						return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
					}).join(",");

					await request.tendersql.pool.execute(
						`INSERT INTO ${sqlCMD_restoreTable} ( caseSID, orderSN, ${caseRestoredColStr} ) VALUES ( ? , ?, ${caseRestoredValStr} )`,
						[ caseSpec.SerialNo, orderSN ]
					);

					console.log(`--- tbl_case SerialNo: ${caseSpec.SerialNo} 結束 ---\n`);
				};

				console.log(`------------ 匯入派工單: ${dispatchSN} 結束 ------------ `);
				console.timeEnd("orderImport");

				return {
					statusCode: 20000,
					message: 'successful',
					data: { deviceType, contractorName, dispatchSN: orderSN }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件檢視
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/detail',
			options: {
				description: '案件檢視',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						serialNo: Joi.number().required().description("tbl_case serialno"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { serialNo, deviceType } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_col = "";
				let sqlCMD_leftJoin = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_leftJoin = 
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredAC.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredAC.IsMarking,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							IFNULL(caseRestoredMK.MarkingImg, JSON_ARRAY()) AS MarkingImg,
							IFNULL(caseRestoredAC.MillingDepth, caseDistress.MillingDepth) AS MillingDepth,
							IFNULL(caseRestoredAC.MillingLength, caseDistress.MillingLength) AS MillingLength,
							IFNULL(caseRestoredAC.MillingWidth, caseDistress.MillingWidth) AS MillingWidth,
							IFNULL(caseRestoredAC.MillingFormula, caseDistress.MillingFormula) AS MillingFormula,
							IFNULL(caseRestoredAC.MillingArea, caseDistress.MillingArea) AS MillingArea,
							IFNULL(caseRestoredAC.uStackerImg, JSON_ARRAY()) AS uStackerImg,
							IFNULL(caseRestoredAC.uSprinklerImg, JSON_ARRAY()) AS uSprinklerImg,
							IFNULL(caseRestoredAC.uDiggerImg, JSON_ARRAY()) AS uDiggerImg,
							IFNULL(caseRestoredAC.uRollerImg, JSON_ARRAY()) AS uRollerImg,
							IFNULL(caseRestoredAC.uPaverImg, JSON_ARRAY()) AS uPaverImg,
							IFNULL(caseRestoredAC.UnderConstrImg, JSON_ARRAY()) AS UnderConstrImg,
							IFNULL(caseRestoredAC.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,`;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_leftJoin =
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredHR.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredHR.IsMarking,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							IFNULL(caseRestoredMK.MarkingImg, JSON_ARRAY()) AS MarkingImg,
							IFNULL(caseRestoredHR.MillingLength, caseDistress.MillingLength) AS MillingLength,
							IFNULL(caseRestoredHR.MillingWidth, caseDistress.MillingWidth) AS MillingWidth,
							IFNULL(caseRestoredHR.MillingFormula, caseDistress.MillingFormula) AS MillingFormula,
							IFNULL(caseRestoredHR.MillingArea, caseDistress.MillingArea) AS MillingArea,
							IFNULL(caseRestoredHR.uStackerImg, JSON_ARRAY()) AS uStackerImg,
							IFNULL(caseRestoredHR.uSprinklerImg, JSON_ARRAY()) AS uSprinklerImg,
							IFNULL(caseRestoredHR.uDiggerImg, JSON_ARRAY()) AS uDiggerImg,
							IFNULL(caseRestoredHR.uRollerImg, JSON_ARRAY()) AS uRollerImg,
							IFNULL(caseRestoredHR.uPaverImg, JSON_ARRAY()) AS uPaverImg,
							IFNULL(caseRestoredHR.UnderConstrImg, JSON_ARRAY()) AS UnderConstrImg,
							IFNULL(caseRestoredHR.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,`;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_leftJoin =
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredFA.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredFA.IsMarking,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							IFNULL(caseRestoredMK.MarkingImg, JSON_ARRAY()) AS MarkingImg,
							IFNULL(caseRestoredFA.IsPressing, caseDistress.IsPressing) AS IsPressing,
							IFNULL(caseRestoredFA.Notes, caseDistress.Notes) AS Notes,
							IFNULL(caseRestoredFA.TaskRealGroup, caseDistress.TaskRealGroup) AS TaskRealGroup,
							IFNULL(caseRestoredFA.KitNotes, caseDistress.KitNotes) AS KitNotes,
							IFNULL(caseRestoredFA.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,
							IFNULL(caseRestoredFA.Image, JSON_OBJECT()) AS Image,`;
						break;
					// NOTE: 補繪標線查詢原始案件
					// case 4:	// 標線
					// 	sqlCMD_restoreTable = "caseRestoredMK";
					// 	sqlCMD_restoreTable_col =
					// 		`caseRestoredMK.IsCancel,
					// 		caseRestoredMK.Contractor AS Contractor_MK,
					// 		caseRestoredMK.OrderSN AS OrderSN_MK,
					// 		caseRestoredMK.IsCancel AS IsCancel_MK,
					// 		caseRestoredMK.DateCompleted_At AS DateClose_MK,`;
					// 	break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						${sqlCMD_restoreTable}.OrderSN,
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						caseDistress.Postal_vil,
						caseDistress.CaseSucc,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						ST_AsGeoJSON(caseDistress.Coordinate) AS Coordinate,
						caseDistress.DateCreate,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						caseDistress.DateDeadline,
						caseOrder.DateCreate_At AS DateAssign,
						caseOrder.DateCompleted_At AS DateClose,
						${sqlCMD_restoreTable_col}
						caseDistress.ImgZoomIn,
						caseDistress.ImgZoomOut,
						deviceType.DName,
						distressType.DistressName,
						tenderBlock.TBName,
						caseType.casetype	
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN tbl_Block AS tenderBlock ON caseDistress.BlockSN = tenderBlock.SerialNo
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1 AND ${sqlCMD_restoreTable}.Contractor != 0
						LEFT JOIN caseOrder ON ${sqlCMD_restoreTable}.OrderSN = caseOrder.id
						${sqlCMD_leftJoin}
					WHERE
						caseDistress.IsActive = 1
						AND caseDistress.SerialNo = ?
					ORDER BY ${sqlCMD_restoreTable}.OrderSN`,
					[ serialNo ] );

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 計價套組
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/taskGroup',
			options: {
				description: '計價套組',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						keyword: Joi.string().allow('').default('').description("TaskGroup GroupName 字串查詢"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, keyword, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD_filter = "";
				if (keyword.length > 0) sqlCMD_filter = ` AND GroupName LIKE '%${keyword}%' `;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						SerialNo,
						GroupName,
						CreateTime,
						DesignDetail,
						DesignDesc,
						DesignWorker
					FROM TaskGroup
					WHERE
						IsActive = 1
						AND DTeam = ?
						${sqlCMD_filter}
					ORDER BY CreateTime
					LIMIT ? OFFSET ?`,
					[ groupId, String(pageSize), String(offset) ]
				);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT
						COUNT(SerialNo) AS total
					FROM TaskGroup
					WHERE
						IsActive = 1
						AND DTeam = ?
						${sqlCMD_filter}`,
					[ groupId ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total: total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/taskGroup',
			options: {
				description: '新增計價套組',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						groupName: Joi.string().required().description("組套名稱"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { groupName, groupId } = request.payload;

				await request.tendersql.pool.execute(
					`INSERT INTO TaskGroup ( GroupName, DTeam ) VALUES ( ?, ? )`,
					[ groupName, groupId ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/dispatch/taskGroup',
			options: {
				description: '刪除計價套組',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						SerialNo: Joi.number().required().description("TaskGroup SerialNo")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { SerialNo } = request.payload;

				await request.tendersql.pool.execute(
					`UPDATE TaskGroup SET IsActive = 0 WHERE SerialNo = ?`,
					[ SerialNo ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/taskGroupDetail',
			options: {
				description: '計價套組詳細',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupSN: Joi.string().required().description("TaskGroup SerialNo")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupSN } = request.query;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						TaskGroupDetail.SerialNo,
						TaskGroupDetail.GroupSN,
						TaskGroupDetail.UnitSN,
						TaskUnit.TaskName,
						TaskUnit.TaskUnit,
						TaskUnit.TaskPrice,
						TaskGroupDetail.TaskNumber AS number,
						TaskGroupDetail.DTeam
					FROM
						TaskGroupDetail
						LEFT JOIN TaskUnit ON (TaskUnit.SerialNo = TaskGroupDetail.UnitSN AND TaskUnit.DTeam = TaskGroupDetail.DTeam)
					WHERE
						TaskGroupDetail.UnitSN IS NOT NULL
						AND TaskGroupDetail.IsActive = 1
						AND TaskGroupDetail.GroupSN = ?
					ORDER BY TaskUnit.Sort`, 
					[ groupSN ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/taskGroupDetail',
			options: {
				description: '修改計價套組詳細',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						serialNo: Joi.number().required().description("TaskGroup SerialNo"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						kitContent: Joi.array().default([]).items(
							Joi.object({
								UnitSN: Joi.string().required().description("項次"),
								TaskName: Joi.string().required().description("工程項目"),
								TaskUnit: Joi.string().required().description("單位"),
								number: Joi.number().default(0).description("數量")
							})
						),
						designDetail: Joi.string().allow('').default('').description("設計施作數量"),
						designDesc: Joi.string().allow('').default('').description("設計施工方式"),
						designWorker: Joi.string().allow('').default('').description("設計施作人力")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { serialNo, groupId, kitContent, designDetail, designDesc, designWorker } = request.payload;

				// 先將之前的欄位disable
				await request.tendersql.pool.execute(
					`UPDATE TaskGroupDetail SET IsActive = 0 WHERE GroupSN = ?`,
					[ serialNo ]
				);

				await request.tendersql.pool.execute(
					`UPDATE TaskGroup SET DesignDetail = ?, DesignDesc = ?, DesignWorker = ? WHERE SerialNo = ?`,
					[ designDetail, designDesc, designWorker, serialNo ]
				);

				for (const kit of kitContent) {
					const taskGroupDetailColStr = Object.keys(kit).map(key => key.replace("number", "TaskNumber")).join(",");
					const taskGroupDetailValStr = Object.values(kit).map(val => {
						return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
					}).join(",");

					await request.tendersql.pool.execute(
						`INSERT INTO TaskGroupDetail ( GroupSN, ${taskGroupDetailColStr}, DTeam ) VALUES ( ?, ${taskGroupDetailValStr}, ? )`,
						[ serialNo, groupId ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/taskReal',
			options: {
				description: '查詢套組內容(設計、實際)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						taskRealGroup: Joi.string().required().description("TaskReal SerialNo"),
						taskRealGroup_Plan: Joi.string().default('0').description("TaskReal SerialNo")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { taskRealGroup, taskRealGroup_Plan } = request.query;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						GroupId,
						SerialNo,
						GroupSN,
						UnitSN,
						TaskName,
						TaskUnit,
						TaskPrice,
						TaskNumber AS number,
						DTeam
					FROM
						TaskReal
					WHERE
						TaskReal.GroupId IN (?, ?)
						AND TaskReal.IsActive = 1`,
					[ taskRealGroup, taskRealGroup_Plan ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 養護判核
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/apply',
			options: {
				description: '案件判核列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseNo: Joi.string().allow('').default('').description("道管編號"),
						caseSN: Joi.string().allow('').default('').description("判核單號"),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, caseNo, caseSN, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD_timeCondi = (timeStart.length != 0 && timeEnd.length != 0) ? ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' ` : '';

				let sqlCMD_filter = "";
				if (caseSN.length != 0) sqlCMD_filter += ` AND caseDistress.ApplyId = (SELECT id FROM caseDistressApply WHERE CaseSN = '${caseSN}')`;
				else sqlCMD_filter += ` AND caseDistress.ApplyId = 0 AND ((IFNULL(caseDistressFlow.FlowState, 0) = 1 AND IFNULL(caseDistressPI.PIState, 0) & 1) OR IFNULL(caseDistressFlowV2.FlowState, 0) = 1)`;
				if (groupId != 0) sqlCMD_filter += ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE groupId = ${groupId}) `;
				if (caseNo.length != 0) sqlCMD_filter += ` AND caseDistress.CaseNo = '${caseNo}' `;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.State,
						caseDistressFlowV2.FlowState,
						caseDistress.DeviceType,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						caseDistress.DateCreate,
						caseDistress.DateDeadline,
						caseDistress.MillingDepth,
						caseDistress.MillingLength,
						caseDistress.MillingWidth,
						caseDistress.MillingFormula,
						caseDistress.MillingArea,
						caseDistress.Aggregate34,
						caseDistress.Aggregate38,
						caseDistress.IsPressing,
						caseDistress.ImgZoomIn,
						caseDistress.ImgZoomOut,
						caseDistress.Notes,
						caseDistress.TaskRealGroup,
						IFNULL(caseDistress.KitNotes, JSON_OBJECT()) AS KitNotes,
						IFNULL(caseDistress.Content, JSON_ARRAY()) AS Content,
						caseDistress.SurveyId,
						caseType.casetype,
						deviceType.DName
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}
					ORDER BY caseDistress.Place
					LIMIT ? OFFSET ?`, 
					[String(pageSize), String(offset)]);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT
						COUNT(SerialNo) AS total
					FROM 
						caseDistress
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}`
				);

				let informType = 1;
				if (caseSN.length != 0) {
					[[{ informType }]] = await request.tendersql.pool.execute(
						`SELECT InformType AS informType FROM caseDistressApply 
						WHERE GroupId = ? AND CaseSN = ?`,
						[ groupId, caseSN  ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total, informType }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/dispatch/apply',
			options: {
				description: '製作判核單',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseSN: Joi.string().allow('').default('').description("申請單號"),
						serialNoArr: Joi.array().items(Joi.number()).required().description("tbl_case SerialNo")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { groupId, deviceType, serialNoArr } = request.payload;
				let { caseSN } = request.payload;

				if (caseSN.length == 0) {
					caseSN = Number(DateTime.now().toFormat("yyyyMM001"));
					caseSN -= 191100000; //轉成民國年
					const [[res_lastId]] = await request.tendersql.pool.execute(
						`SELECT CaseSN AS lastId FROM caseDistressApply WHERE GroupId = ? AND CaseSN >= ? ORDER BY id DESC LIMIT 1`,
						[ groupId, caseSN ]
					);
					caseSN = res_lastId ? Number(res_lastId.lastId) + 1 : caseSN;
				}

				const [ res_inform ] = await request.tendersql.pool.execute(
					`INSERT INTO caseDistressApply (CaseSN, GroupId, InformType, InformState, Create_By, Create_At, Bit1_At) VALUES (?, ?, ?, 1, ?, NOW(), NOW())
						ON DUPLICATE KEY UPDATE Update_By = ?, Update_At = NOW()`,
					[ caseSN, groupId, deviceType, uid, uid ]
				);

				for (const serialNo of serialNoArr) {
					await request.tendersql.pool.execute(
						`INSERT INTO caseDistressFlowV2 (DistressId, CaseSN, FlowDesc, Create_By, Create_At) VALUES (?, ?, ?, ?, NOW())
							ON DUPLICATE KEY UPDATE CaseSN = ?, Update_By = ?, Update_At = NOW()`,
						[ serialNo, caseSN, '{}', uid, caseSN, uid ]
					);

					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET ApplyId = ?, RoadType = ?, RestoredType = ? WHERE SerialNo = ?`,
						[ res_inform.insertId, ([1, 2].includes(deviceType)) ? 1 : 2, ([1, 2].includes(deviceType)) ? deviceType : 0, serialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { caseSN }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/applyTicketList',
			options: {
				description: '判核單列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseSN: Joi.string().allow('').default('').description("申請單號"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, caseSN, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD_filter = "";
				// let sqlCMD_timeCondi = (timeStart.length != 0 && timeEnd.length != 0) ? ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' ` : '';

				if (groupId != 0) sqlCMD_filter += ` AND caseDistressApply.GroupId = ${groupId} `;
				if (caseSN.length != 0) sqlCMD_filter += ` AND caseDistressApply.CaseSN = '${caseSN}' `;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistressApply.id,
						caseDistressApply.InformType,
						caseDistressApply.GroupId,
						caseDistressApply.CaseSN,
						distressFlow.total,
						caseDistressApply.InformState,
						caseDistressApply.Create_By,
						caseDistressApply.Create_At,
						caseDistressApply.Bit1_At,
						caseDistressApply.Bit2_At,
						caseDistressApply.Bit4_At,
						caseDistressApply.Bit8_At,
						caseDistressApply.Bit16_At,
						caseDistressApply.Bit32_At,
						distressFlow.CaseNoObj
					FROM
						caseDistressApply
						LEFT JOIN (
							SELECT
								caseDistressApply.id,
								caseDistressApply.GroupId,
								COUNT(*) AS total,
								JSON_OBJECTAGG(CaseNo, JSON_OBJECT('State', State, 'FlowState', FlowState)) AS CaseNoObj
							FROM
								caseDistressFlowV2
								LEFT JOIN caseDistress ON caseDistress.SerialNo = caseDistressFlowV2.DistressId
								LEFT JOIN caseDistressApply ON caseDistressApply.id = caseDistress.ApplyId
							WHERE caseDistressFlowV2.CaseSN != 0
							GROUP BY caseDistressApply.id, caseDistressFlowV2.CaseSN, caseDistressApply.GroupId
						) AS distressFlow ON distressFlow.id = caseDistressApply.id AND distressFlow.GroupId = caseDistressApply.GroupId
					WHERE 
						IsActive IS TRUE
						${sqlCMD_filter}
					LIMIT ? OFFSET ?`,
					[String(pageSize), String(offset)]);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT COUNT(*) AS total
					FROM caseDistressApply
					WHERE IsActive IS TRUE`
				);
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/applyTicketListPDF',
			options: {
				description: '通報單列表PDF',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						ApplyId: Joi.number().default(0).description("申請單號"),
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { ApplyId } = request.query;
				
				// 現有 道管系統案號CaseNo 地點Place 查報日期DateUpload 預訂完工日期DateDeadline 損壞類別DistressType 面積MillingArea 長度MillingLength
				// 寬度MillingWidth 深度MillingDepth

				// 欄位未確定 施工前會勘 核可文號 施工前項次 標線面積 切格長度 備註 標線顏料 標線名稱 標線面積算式 面積小計
				const [ res ] = await request.tendersql.pool.execute(`
					SELECT CaseNo, Place, DateUpload, DateDeadline, DistressType, MillingArea, MillingLength, MillingWidth, MillingDepth
					FROM caseDistress
					WHERE ApplyId = ?`,
					[ApplyId]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res }
				};
			},
		});

		server.route({
			method: 'PUT',
			path: '/dispatch/applyTicketList/{id}',
			options: {
				description: '判核單列表(提交結果)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						informState: Joi.number().required().description("狀態(1: 建單, 2: 判核, 4: 會勘, 8: 派工, 16: 計價, 32: 結案)"),
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { informState } = request.payload;

				let state = 1;
				if(informState & 32) state = 32;
				else if(informState & 16) state = 16;
				else if(informState & 8) state = 8;
				else if(informState & 4) state = 4;
				else if(informState & 2) state = 2;



				await request.tendersql.pool.execute(
					`UPDATE caseDistressApply SET InformState = ?, Update_By = ?, Update_At = NOW(), Bit${state}_At = NOW()
					WHERE IsActive IS TRUE AND id = ?`,
					[informState, uid, id]
				);

				if(informState == 7) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET State = 3, DateUpdate_At = NOW()
						WHERE IsActive IS TRUE AND ApplyId = ?`,
						[id]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/applyReview',
			options: {
				description: '分工判核列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().required().description("TendersGroup groupId"),
						caseSN: Joi.string().required().description("申請單號"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, caseSN, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.State,
						caseDistressFlowV2.FlowState,
						caseDistressFlowV2.FlowDesc,
						caseDistress.DeviceType,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						caseDistress.DateCreate,
						caseDistress.DateDeadline,
						caseDistress.MillingDepth,
						caseDistress.MillingLength,
						caseDistress.MillingWidth,
						caseDistress.MillingFormula,
						caseDistress.MillingArea,
						caseDistress.IsPressing,
						caseDistress.ImgZoomIn,
						caseDistress.ImgZoomOut,
						caseDistress.Notes,
						caseDistress.TaskRealGroup,
						IFNULL(caseDistress.KitNotes, JSON_OBJECT()) AS KitNotes,
						caseDistress.SurveyId,
						caseType.casetype,
						deviceType.DName
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN caseDistressApply ON caseDistressApply.id = caseDistress.ApplyId
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						AND caseDistressApply.GroupId = ?
						AND caseDistress.CaseSN = ?
					ORDER BY caseDistress.Place
					LIMIT ? OFFSET ?`,
					[groupId, caseSN, String(pageSize), String(offset)]);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT
						COUNT(SerialNo) AS total
					FROM 
						caseDistress
						LEFT JOIN caseDistressApply ON caseDistressApply.id = caseDistress.ApplyId
					WHERE
						caseDistress.IsActive = 1
						AND caseDistressApply.GroupId = ?
						AND caseDistress.CaseSN = ?`,
					[groupId, caseSN]);
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 養護通報
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/applyInform',
			options: {
				description: '案件通報列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseNo: Joi.string().allow('').default('').description("道管編號"),
						caseSN: Joi.string().allow('').default('').description("通報單號"),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, caseNo, caseSN, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD_timeCondi = (timeStart.length != 0 && timeEnd.length != 0) ? ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' ` : '';

				let sqlCMD_filter = "";
				if (caseSN.length != 0) sqlCMD_filter += ` AND caseDistress.InformId = (SELECT id FROM caseDistressInform WHERE CaseSN = '${caseSN}')`;
				else sqlCMD_filter += ` AND caseDistress.InformId IS NULL AND IFNULL(caseDistressFlowV2.FlowState, 0) & 4`;
				if (groupId != 0) sqlCMD_filter += ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE groupId = ${groupId}) `;
				if (caseNo.length != 0) sqlCMD_filter += ` AND caseDistress.CaseNo = '${caseNo}' `;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.State,
						caseDistressFlowV2.FlowState,
						caseDistress.DeviceType,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						caseDistress.DateCreate,
						caseDistress.DateDeadline,
						caseDistress.MillingDepth,
						caseDistress.MillingLength,
						caseDistress.MillingWidth,
						caseDistress.MillingFormula,
						caseDistress.MillingArea,
						caseDistress.Aggregate34,
						caseDistress.Aggregate38,
						caseDistress.IsPressing,
						caseDistress.ImgZoomIn,
						caseDistress.ImgZoomOut,
						caseDistress.Notes,
						caseDistress.TaskRealGroup,
						IFNULL(caseDistress.KitNotes, JSON_OBJECT()) AS KitNotes,
						IFNULL(caseDistress.Content, JSON_ARRAY()) AS Content,
						caseDistress.SurveyId,
						caseType.casetype,
						deviceType.DName,
						caseDistress.InformId,
						caseDistressInform.InformState
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
						LEFT JOIN caseDistressInform ON caseDistressInform.id = caseDistress.InformId
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}
					ORDER BY caseDistress.Place
					LIMIT ? OFFSET ?`, 
					[String(pageSize), String(offset)]);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT
						COUNT(SerialNo) AS total
					FROM 
						caseDistress
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}`
				);

				let informType = 1;
				if (caseSN.length != 0) {
					[[{ informType }]] = await request.tendersql.pool.execute(
						`SELECT InformType AS informType FROM caseDistressInform
						WHERE GroupId = ? AND CaseSN = ?`,
						[ groupId, caseSN  ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total, informType }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/dispatch/applyInform',
			options: {
				description: '製作通報單',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseSN: Joi.string().allow('').default('').description("申請單號"),
						serialNoArr: Joi.array().items(Joi.number()).required().description("tbl_case SerialNo")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { groupId, deviceType, serialNoArr } = request.payload;
				let { caseSN } = request.payload;

				if (caseSN.length == 0) {
					caseSN = Number(DateTime.now().toFormat("yyyyMM001"));
					caseSN -= 191100000; //轉成民國年
					const [[res_lastId]] = await request.tendersql.pool.execute(
						`SELECT CaseSN AS lastId FROM caseDistressInform WHERE GroupId = ? AND CaseSN >= ? ORDER BY id DESC LIMIT 1`,
						[groupId, caseSN]
					);
					caseSN = res_lastId ? Number(res_lastId.lastId) + 1 : caseSN;
				}

				const [res_inform] = await request.tendersql.pool.execute(
					`INSERT INTO caseDistressInform (CaseSN, GroupId, InformType, InformState, Create_By, Create_At, Bit1_At) VALUES (?, ?, ?, 3, ?, NOW(), NOW())
						ON DUPLICATE KEY UPDATE Update_By = ?, Update_At = NOW()`,
					[caseSN, groupId, deviceType, uid, uid]
				);

				for (const serialNo of serialNoArr) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET InformId = ?, RoadType = ?, RestoredType = ? WHERE SerialNo = ?`,
						[res_inform.insertId, ([1, 2].includes(deviceType)) ? 1 : 2, ([1, 2].includes(deviceType)) ? deviceType : 0, serialNo]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { caseSN }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/informTicketList',
			options: {
				description: '通報單管理列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						caseSN: Joi.string().allow('').default('').description("申請單號"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, caseSN, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD_filter = "";
				// let sqlCMD_timeCondi = (timeStart.length != 0 && timeEnd.length != 0) ? ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' ` : '';

				if (groupId != 0) sqlCMD_filter += ` AND caseDistressInform.GroupId = ${groupId} `;
				if (caseSN.length != 0) sqlCMD_filter += ` AND caseDistressInform.CaseSN = '${caseSN}' `;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistressInform.id,
						caseDistressInform.InformType,
						caseDistressInform.GroupId,
						caseDistressInform.CaseSN,
						distressFlow.total,
						caseDistressInform.InformState,
						caseDistressInform.Create_By,
						caseDistressInform.Create_At,
						caseDistressInform.Bit1_At,
						caseDistressInform.Bit2_At,
						caseDistressInform.Bit4_At,
						caseDistressInform.Bit8_At,
						caseDistressInform.Bit16_At,
						caseDistressInform.Bit32_At,
						distressFlow.CaseNoObj
					FROM
						caseDistressInform
						LEFT JOIN (
							SELECT
								caseDistressInform.id,
								caseDistressInform.GroupId,
								COUNT(*) AS total,
								JSON_OBJECTAGG(CaseNo, JSON_OBJECT('State', State, 'FlowState', FlowState)) AS CaseNoObj
							FROM
								caseDistressFlowV2
								LEFT JOIN caseDistress ON caseDistress.SerialNo = caseDistressFlowV2.DistressId
								LEFT JOIN caseDistressInform ON caseDistressInform.id = caseDistress.InformId
							WHERE caseDistressInform.CaseSN != 0
							GROUP BY caseDistressInform.CaseSN, caseDistressInform.GroupId
						) AS distressFlow ON distressFlow.id = caseDistressInform.id AND distressFlow.GroupId = caseDistressInform.GroupId
					WHERE 
						IsActive IS TRUE AND JSON_VALID(distressFlow.CaseNoObj) IS NOT NULL
						${sqlCMD_filter}
					LIMIT ? OFFSET ?`,
					[String(pageSize), String(offset)]);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT COUNT(*) AS total
					FROM caseDistressInform
					WHERE IsActive IS TRUE `
				);
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/informRoadPDF',
			options: {
				description: '通報單管理 - 施工階段PDF',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						id: Joi.number().required().description('inform id'),
						GroupId: Joi.number().required().required().description("Dteam")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { id, GroupId } = request.query;

				// 契約名稱 契約編號
				const [ contract ] = await request.tendersql.pool.execute(`
					SELECT groupName, groupSN 
					FROM TendersGroup
					WHERE groupId = ?`,
					[GroupId]
				);

				// 道路預約式契約維護修繕工程
				// p47 項次 道管系統案號 查報日期 預定完工日期 地點 損壞類別 面積m2
				const [ res ] = await request.tendersql.pool.execute(`
					SELECT d.SerialNo, d.CaseNo, d.DateCreate, d.DateDeadline, d.Place, t.DistressName, d.MillingArea
					FROM caseDistressInform AS i
					LEFT JOIN caseDistress AS d ON d.InformId = i.id
					LEFT JOIN tbl_DistressType AS t ON t.SerialNo = d.DistressType
					WHERE i.id = ?`,
					[id]
				);

				const [ res_count ] = await request.tendersql.pool.execute(`
					SELECT COUNT(*) as total
					FROM caseDistressInform AS i
					LEFT JOIN caseDistress AS d ON d.InformId = i.id
					LEFT JOIN tbl_DistressType AS t ON t.SerialNo = d.DistressType
					WHERE i.id = ?`,
					[id]
				);

				// 臺北市政府工務局新建工程處養護工程隊開口合約施工通知 / 回報單
				// p45 p48項次 主要項目 單位 數量 設計預估金額 施作數量 施工方式 施作人力
				const [ res2 ] = await request.tendersql.pool.execute(`
					SELECT
						d.SerialNo, d.Place, 
						r.UnitSN, r.TaskName, r.TaskUnit, r.TaskNumber, r.TaskPrice,
						g.DesignDetail, g.DesignDesc, g.DesignWorker
					FROM caseDistress AS d
					LEFT JOIN TaskReal AS r ON r.GroupId = d.TaskRealGroup
					LEFT JOIN TaskGroup AS g ON g.SerialNo = r.GroupSN
					WHERE d.InformId = ? AND UnitSN IS NOT NULL`,
					[id]
				);
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: contract, res_count, res, res2 }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/completeRoadPDF',
			options: {
				description: '通報單管理 - 完工會勘PDF',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						id: Joi.number().required().description('inform id'),
						GroupId: Joi.number().required().required().description("Dteam")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { id, GroupId } = request.query;

				// 契約名稱 契約編號
				const [ contract ] = await request.tendersql.pool.execute(`
					SELECT groupName, groupSN 
					FROM TendersGroup
					WHERE groupId = ?`,
					[GroupId]
				);

				// p16 聖東完工會勘路段表
				const [ res ] = await request.tendersql.pool.execute(`
					SELECT 
						d.SerialNo, d.CaseNo, d.DateCreate, d.DateDeadline, d.Place, d.ImgZoomIn,
						t.DistressName,
						r.PostConstrImg
					FROM caseDistressInform AS i
					LEFT JOIN caseDistress AS d ON d.InformId = i.id
					LEFT JOIN tbl_DistressType AS t ON t.SerialNo = d.DistressType
					LEFT JOIN caseRestoredFA AS r ON r.caseSID = d.SerialNo
					WHERE i.id = ?`,
					[id]
				);

				const [ res_count ] = await request.tendersql.pool.execute(`
					SELECT COUNT(*) as total
					FROM caseDistressInform AS i
					LEFT JOIN caseDistress AS d ON d.InformId = i.id
					LEFT JOIN tbl_DistressType AS t ON t.SerialNo = d.DistressType
					WHERE i.id = ?`,
					[id]
				);

				// 臺北市政府工務局新建工程處養護工程隊開口合約施工通知 / 回報單
				// p45 p48項次 主要項目 單位 數量 設計預估金額 施作數量 施工方式 施作人力
				const [ res2 ] = await request.tendersql.pool.execute(`
					SELECT
						d.SerialNo, d.Place, 
						r.UnitSN, r.TaskName, r.TaskUnit, r.TaskNumber, r.TaskPrice,
						g.DesignDetail, g.DesignDesc, g.DesignWorker
					FROM caseDistress AS d
					LEFT JOIN TaskReal AS r ON r.GroupId = d.TaskRealGroup
					LEFT JOIN TaskGroup AS g ON g.SerialNo = r.GroupSN
					WHERE d.InformId = ? AND UnitSN IS NOT NULL`,
					[id]
				);
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: contract, res, res_count, res2 }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/dispatch/reportRoadPDF',
			options: {
				description: '通報單管理 - 回報市府PDF',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						id: Joi.number().required().description('inform id'),
						GroupId: Joi.number().required().required().description("Dteam")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { id, GroupId } = request.query;

				// 工程名稱(契約名稱)
				const [ contract ] = await request.tendersql.pool.execute(`
					SELECT groupName
					FROM TendersGroup
					WHERE groupId = ?`,
					[GroupId]
				);

				// 臺北市政府工務局新建工程處養護工程隊修復回報單
				// 編號(沒欄位) 修復地點 施工日期(目前沒欄位) 道館案號 座標 修復項目 實際數量
				const [ res ] = await request.tendersql.pool.execute(`
					SELECT 
						d.Place, d.CaseNo, d.CoordinateX, d.CoordinateY, d.ImgZoomIn,
						g.DesignDetail, g.DesignDesc,
						fa.PostConstrImg
					FROM caseDistress AS d
					LEFT JOIN TaskReal AS r ON r.GroupId = d.TaskRealGroup
					LEFT JOIN TaskGroup AS g ON g.DTeam = r.GroupId
					LEFT JOIN caseRestoredFA AS fa ON fa.caseSID = d.SerialNo
					WHERE d.InformId = ?`,
					[id] 
				);
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: contract, res }
				};
			},
		});

		server.route({
			method: 'PUT',
			path: '/dispatch/informTicketList/{id}',
			options: {
				description: '通報單管理(提交結果)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						informState: Joi.number().required().description("狀態(1: 建單, 2: 判核, 4: 會勘, 8: 派工, 16: 計價, 32: 結案)"),
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { informState } = request.payload;

				let state = 1;
				if(informState & 32) state = 32;
				else if(informState & 16) state = 16;
				else if(informState & 8) state = 8;
				else if(informState & 4) state = 4;
				else if(informState & 2) state = 2;
				
				await request.tendersql.pool.execute(
					`UPDATE caseDistressInform SET InformState = ?, Update_By = ?, Update_At = NOW(), Bit${state}_At = NOW()
					WHERE IsActive IS TRUE AND id = ?`,
					[informState, uid, id]
				);

				if(informState == 7) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET State = 3, DateUpdate_At = NOW()
						WHERE IsActive IS TRUE AND ApplyId = ?`,
						[id]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		server.route({
			method: 'PUT',
			path: '/dispatch/informTicketState/{id}',
			options: {
				description: '通報單管理(施工前會勘刪除)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						informState: Joi.number().required().description("狀態(1: 建單, 2: 判核, 4: 會勘, 8: 派工, 16: 計價, 32: 結案)"),
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { informState } = request.payload;

				// let state = 1;
				// if(informState & 32) state = 32;
				// else if(informState & 16) state = 16;
				// else if(informState & 8) state = 8;
				// else if(informState & 4) state = 4;
				// else if(informState & 2) state = 2;
				
				// await request.tendersql.pool.execute(
				// 	`UPDATE caseDistressInform SET InformState = ?, Update_By = ?, Update_At = NOW()
				// 	WHERE IsActive IS TRUE AND id = ?`,
				// 	[informState, uid, id]
				// );

				if (informState == 3) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET InformId = 0, DateUpdate_At = NOW()
						WHERE IsActive IS TRUE AND InformId = ?`,
						[id]
					);
				}
				
				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 施作分派
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/plan',
			options: {
				description: '施作分派列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已派工」"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						reportSN: Joi.string().allow('').default('').description("通報單號"),
						keywords: Joi.string().allow('').default('').description("地點關鍵字"),
						caseSN: Joi.string().allow('').default('').description("申請單號"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, groupId, reportSN, keywords, caseSN, deviceType, timeStart, timeEnd } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_dType = 
							` AND caseDistress.RoadType = 1 
							AND caseDistress.RestoredType = 1 
							AND caseDistress.DeviceType <> 5 
							AND caseDistress.DistressType NOT IN ( '20', '23' )  `;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_dType =
							` AND caseDistress.RoadType = 1 
							AND caseDistress.RestoredType = 2 
							AND caseDistress.DistressType NOT IN ( '20', '23' )  `;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_dType = ` AND caseDistress.RoadType IN (2, 3) `;
						// 	AND caseList.recoverflag = '0'
						// 	AND caseList.sctype1flag = '0'
						// 	AND ( ( caseList.paperflag = '1' ) OR ( caseList.btype = '20' AND caseList.paperflag = '0' ) )  `;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_dType = ` AND (caseDistress.DeviceType = 4 OR caseRestoredMK.OrderSN = '0') `;
						// sqlCMD_dType =
						// 	` AND caseList.sctype1flag NOT IN ( '2', '3' ) 
						// 	AND caseList.casesn <> '0' 
						// 	AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
						// 	AND markline.casecsn IS NOT NULL`;
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				let sqlCMD_restoreTable_col = "";
				let sqlCMD_filter = "";
				let sqlCMD_leftJoin = "";
				let sqlCMD_timeCondi = "";
				if(filter) {
					sqlCMD_filter = ` AND caseDistress.State = 7 AND ${sqlCMD_restoreTable}.OrderSN = '0'`;
					sqlCMD_restoreTable_col = ` ${sqlCMD_restoreTable}.DateCreate_At AS DatePlanBefore, `;
					sqlCMD_timeCondi = ` AND ${sqlCMD_restoreTable}.DateCreate_At >= '${timeStart}' AND ${sqlCMD_restoreTable}.DateCreate_At < '${timeEnd}' `;
				} else {
					sqlCMD_filter = ` AND caseDistress.State IN (3, 11) `;
					sqlCMD_restoreTable_col = ` ${sqlCMD_restoreTable}_before.DateCreate_At AS DatePlanBefore, `;
					sqlCMD_leftJoin = ` LEFT JOIN (SELECT MAX(caseSID) AS caseSID, MAX(Contractor) AS Contractor, MAX(OrderSN) AS OrderSN, MAX(DateCreate_At) AS DateCreate_At FROM ${sqlCMD_restoreTable} WHERE IsActive = 0 GROUP BY caseSID ) AS ${sqlCMD_restoreTable}_before ON caseDistress.SerialNo = ${sqlCMD_restoreTable}_before.caseSID `;
					sqlCMD_timeCondi = ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' `;
				}
				// if (tenderId.length != 0) sqlCMD_filter += ` AND caseDistress.BlockSN IN (SELECT SerialNo FROM tbl_Block WHERE DTeam = '${tenderId}') `;
				if (groupId != 0) sqlCMD_filter += ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE groupId = ${groupId}) `;
				if (reportSN.length != 0) sqlCMD_filter += ` AND caseDistress.CaseSN = '${reportSN}' `;
				if (keywords.length != 0) sqlCMD_filter += ` AND caseDistress.Place LIKE '%${keywords}%' `;
				if (caseSN.length != 0) sqlCMD_filter += ` AND caseDistress.CaseSN = '${caseSN}' `;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistressFlowV2.FlowState,
						caseDistressApply.GroupId,
						tenderBlock.DTeam,
						(CASE WHEN caseDistress.State = 7 THEN ${sqlCMD_restoreTable}.Contractor ELSE "" END) AS Contractor,
						caseDistress.Place,
						caseDistress.DateDeadline,
						caseDistress.MillingDepth,
						caseDistress.MillingLength,
						caseDistress.MillingWidth,
						caseDistress.MillingFormula,
						caseDistress.MillingArea,
						caseDistress.IsPressing,
						caseDistress.Notes,
						caseDistress.TaskRealGroup,
						IFNULL(caseDistress.KitNotes, JSON_OBJECT()) AS KitNotes,
						IFNULL(${sqlCMD_restoreTable}.id, 0) AS RestoredId,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						(caseDistress.State = 11) AS IsReturn,
						caseDistress.StateNotes,
						${sqlCMD_restoreTable_col}
						caseType.casetype,
						deviceType.DName
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_Block AS tenderBlock ON caseDistress.BlockSN = tenderBlock.SerialNo
						LEFT JOIN caseDistressApply ON caseDistressApply.id = caseDistress.ApplyId
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1
						${sqlCMD_leftJoin} 
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_dType}
						${sqlCMD_filter}
						${sqlCMD_timeCondi}
					ORDER BY caseDistress.Place`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/plan',
			options: {
				description: '主任分派',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						caseList: Joi.array().min(1).items(Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							RestoredId: Joi.number().default(0).description("caseRestored Id"),
							// DateDeadline: Joi.string().required().description("完工期限"),
							MillingLength: Joi.number().default(0).description("預估長度"),
							MillingWidth: Joi.number().default(0).description("預估寬度"),
							MillingDepth: Joi.number().default(0).description("預估深度"),
							MillingFormula: Joi.string().default('0').description("預估複雜算式"),
							MillingArea: Joi.number().default(0).description("預估面積"),
							IsPressing: Joi.number().allow(0, 1).default(0).description("是否急件"),
							Notes: Joi.string().allow('').default('').description("備註(c5type)"),
							TaskRealGroup: Joi.number().default(0).description("TaskReal SerialNo"),
							KitNotes: Joi.string().default('{}').description("計價套組備註")
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { contractor, deviceType,  caseList } = request.payload;

				let sqlCMD_restoreTable = "";
				let restoredColArr = [ "RestoredId", "SerialNo" ];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						restoredColArr.push("IsPressing", "Notes", "TaskRealGroup", "KitNotes");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				for (const caseSpec of caseList) {
					if (!caseSpec.RestoredId || caseSpec.RestoredId == 0) restoredColArr = restoredColArr.filter(col => (col != "RestoredId"));

					const restoredColStr = restoredColArr.map(col => (col == "RestoredId" ? "id" : col == "SerialNo" ? "caseSID" : col)).join(",");
					const restoredValStr = restoredColArr.map(col => {
						return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
							? `'${caseSpec[col]}'` : `${caseSpec[col]}`;
					}).join(",");

					const restoredUpdateStr = restoredColArr.filter(col => (![ "RestoredId", "TaskRealGroup" ].includes(col))).map(col => {
						let key = col;
						if (col == "SerialNo") key = "caseSID";
						return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
							? `${key} = '${caseSpec[col]}'` : `${key} = ${caseSpec[col]}`;
					}).join(",");

					await request.tendersql.pool.execute(
						`INSERT INTO ${sqlCMD_restoreTable} ( ${restoredColStr}, Contractor ) VALUES ( ${restoredValStr}, ? )
						ON DUPLICATE KEY UPDATE ${restoredUpdateStr}, DateCreate_At = NOW(), Contractor = ?`,
						[ contractor, contractor ]
					)

					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET State = 7 WHERE SerialNo = ?`,
						[ caseSpec.SerialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/planSpec',
			options: {
				description: '設計數量寫入',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						caseSpec: Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							MillingLength: Joi.number().default(0).description("預估長度"),
							MillingWidth: Joi.number().default(0).description("預估寬度"),
							MillingDepth: Joi.number().default(0).description("預估深度"),
							MillingFormula: Joi.string().default('0').description("預估複雜算式"),
							MillingArea: Joi.number().default(0).description("預估面積"),
							Aggregate34: Joi.number().default(0).description("3/4粒料用量"),
							Aggregate38: Joi.number().default(0).description("3/8粒料用量"),
							IsPressing: Joi.number().allow(0, 1).default(0).description("是否急件"),
							Notes: Joi.string().allow('').default('').description("備註(c5type)"),
							Content: Joi.string().default('[]').description("標線項目"),
							TaskRealGroup: Joi.number().default(0).description("TaskReal SerialNo"),
							KitContent: Joi.array().default([]).items(
								Joi.object({
									GroupSN: Joi.number().default(0).description("組套序號"),
									UnitSN: Joi.string().required().description("項次"),
									TaskName: Joi.string().required().description("工程項目"),
									TaskUnit: Joi.string().required().description("單位"),
									number: Joi.number().default(0).description("數量"),
									TaskPrice: Joi.number().default(0).description("單價"),
									DTeam: Joi.string().required().description("合約")
								})
							).description("計價套組項目"),
							KitNotes: Joi.string().default('{}').description("計價套組備註")
						})
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { deviceType, caseSpec } = request.payload;

				let sqlCMD_restoreTable = "";
				let restoredColArr = [ "SerialNo" ];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea", "Aggregate34", "Aggregate38");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						restoredColArr.push("IsPressing", "Notes", "KitNotes");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						restoredColArr.push("Content");
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				// 寫入設施套組(設計)
				if (deviceType == 3 && caseSpec.KitContent.length > 0) {
					// 先將之前的欄位disable
					await request.tendersql.pool.execute(
						`UPDATE TaskReal SET IsActive = 0 WHERE GroupId = ?`,
						[ caseSpec.TaskRealGroup ]
					);

					const [[ res_lastGroupId ]] = await request.tendersql.pool.execute(
						`SELECT GroupId AS lastGroupId FROM TaskReal ORDER BY GroupId DESC LIMIT 1`
					);
					caseSpec.TaskRealGroup = res_lastGroupId ? Number(res_lastGroupId.lastGroupId) + 1 : 1;
					restoredColArr.push("TaskRealGroup");

					for (const kit of caseSpec.KitContent) {
						const taskRealColStr = Object.keys(kit).map(key => key.replace("number", "TaskNumber")).join(",");
						const taskRealValStr = Object.values(kit).map(val => {
							return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
						}).join(",");

						await request.tendersql.pool.execute(
							`INSERT INTO TaskReal ( GroupId, caseSID, ${taskRealColStr} ) VALUES ( ?, ?, ${taskRealValStr} )`,
							[ caseSpec.TaskRealGroup, caseSpec.SerialNo ]
						);
					}

					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET TaskRealGroup = ? WHERE SerialNo = ?`,
						[ caseSpec.TaskRealGroup, caseSpec.SerialNo ]
					);
				}

				if (!caseSpec.RestoredId || caseSpec.RestoredId == 0) restoredColArr = restoredColArr.filter(col => (col != "RestoredId"));

				const restoredColStr = restoredColArr.map(col => (col == "SerialNo" ? "caseSID" : col)).join(",");
				const restoredValStr = restoredColArr.map(col => {
					return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
						? `'${caseSpec[col]}'` : `${caseSpec[col]}`;
				}).join(",");

				const restoredUpdateStr = restoredColArr.filter(col => (col != "RestoredId")).map(col => {
					let key = col;
					if (col == "SerialNo") key ="caseSID";
					return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
						? `${key} = '${caseSpec[col]}'` : `${key} = ${caseSpec[col]}`;
				}).join(",");

				const [ res_restore ] = await request.tendersql.pool.execute(
					`SELECT id FROM ${sqlCMD_restoreTable} WHERE caseSID = ?`,
					[ caseSpec.SerialNo ]
				);

				if(res_restore.length == 0) {
					await request.tendersql.pool.execute(
						`INSERT INTO ${sqlCMD_restoreTable} ( ${restoredColStr} ) VALUES ( ${restoredValStr} )
						ON DUPLICATE KEY UPDATE ${restoredUpdateStr}, DateCreate_At = NOW()`
					);
				} else {
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET ${restoredUpdateStr}, DateCreate_At = NOW()
						WHERE caseSID = ?`,
						[ caseSpec.SerialNo ]
					);
				}

				const distressUpdateStr = [ ...restoredColArr, "Content"].filter(col => (!["RestoredId", "SerialNo"].includes(col))).map(col => {
					let key = col;
					return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
						? `${key} = '${caseSpec[col]}'` : `${key} = ${caseSpec[col]}`;
				}).join(",");

				if(distressUpdateStr.length != 0) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistress SET ${distressUpdateStr} WHERE SerialNo = ?`,
						[ caseSpec.SerialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 派工審核
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/jobReview',
			options: {
				description: '派工審核列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						// contractor: Joi.number().required().description("施工廠商 guildCode"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						reportSN: Joi.string().allow('').default('').description("通報單號"),
						keywords: Joi.string().allow('').default('').description("地點關鍵字"),
						deviceType: Joi.number().required().description("維護類型 - 1: 道路, 2: 熱再生, 3: 設施, 4: 標線")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, reportSN, keywords, deviceType } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_col = "";
				let sqlCMD_leftJoin = "";
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_restoreTable_col =
							`caseRestoredAC.MillingDepth,
							caseRestoredAC.MillingLength,
							caseRestoredAC.MillingWidth,
							caseRestoredAC.MillingFormula,
							caseRestoredAC.MillingArea,`;

						sqlCMD_dType =
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '1' 
							AND caseDistress.DeviceType <> '4' `;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_restoreTable_col =
							`caseRestoredHR.MillingDepth,
							caseRestoredHR.MillingLength,
							caseRestoredHR.MillingWidth,
							caseRestoredHR.MillingFormula,
							caseRestoredHR.MillingArea,`;

						sqlCMD_dType =
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '2' 
							AND caseDistress.DeviceType <> '5' `;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_restoreTable_col =
							`caseRestoredFA.IsPressing,
							caseRestoredFA.Notes,
							caseRestoredFA.TaskRealGroup,
							IFNULL(caseRestoredFA.KitNotes, JSON_OBJECT()) AS KitNotes,`;
						sqlCMD_dType = ` AND caseDistress.RoadType IN (2, 3) `;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_restoreTable_col = `caseRestoredMK.IsCancel,`;
						// sqlCMD_leftJoin = `LEFT JOIN caseRestoredAC ON caseRestoredAC.caseSID = caseRestoredMK.caseSID AND caseRestoredAC.IsActive = 1`;
						// sqlCMD_restoreTable_col = `caseRestoredAC.DateCompleted_At AS DateClose_AC, `;
						// sqlCMD_dType =
						// 	` AND caseList.sctype1flag NOT IN ( '2', '3' ) 
						// 	AND caseList.casesn <> '0' 
						// 	AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
						// 	AND markline.casecsn IS NOT NULL`;
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType");

				let sqlCMD_filter = "";
				// if (tenderId.length != 0) sqlCMD_filter += ` AND caseDistress.BlockSN IN (SELECT SerialNo FROM tbl_Block WHERE DTeam = '${tenderId}') `;
				if (groupId != 0) sqlCMD_filter += ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE groupId = ${groupId}) `;
				if (reportSN.length != 0) sqlCMD_filter += ` AND caseDistress.CaseSucc = '${reportSN}' `;
				if (keywords.length != 0) sqlCMD_filter += ` AND caseDistress.Place LIKE '%${keywords}%' `;

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.Postal_vil,
						${sqlCMD_restoreTable}.Contractor,
						caseDistress.Place,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						caseDistress.DateDeadline,
						${sqlCMD_restoreTable_col}
						caseDistress.ImgZoomOut,
						deviceType.DName,
						distressType.DistressName,
						tenderBlock.TBName,
						caseType.casetype
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN tbl_Block AS tenderBlock ON caseDistress.BlockSN = tenderBlock.SerialNo
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1
						${sqlCMD_leftJoin}
					WHERE
						caseDistress.IsActive = 1
						AND caseDistress.State = 7
						AND ${sqlCMD_restoreTable}.OrderSN = '0'
						${sqlCMD_dType}
						${sqlCMD_filter}
					ORDER BY ${sqlCMD_restoreTable}.DateCreate_At, ${sqlCMD_restoreTable}.OrderIndex`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/jobSubCTR',
			options: {
				description: '派工審核(分派給小包)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						caseList: Joi.array().min(1).items(Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo")
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { contractor, deviceType, caseList } = request.payload;

				let sqlCMD_restoreTable = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType");

				for (const caseSpec of caseList) {
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET Contractor = ? WHERE caseSID = ? AND IsActive = 1`,
						[ contractor, caseSpec.SerialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 製作派工單
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/jobTicket',
			options: {
				description: '廠商派工單列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						reportSN: Joi.string().allow('').default('').description("通報單號"),
						keywords: Joi.string().allow('').default('').description("地點關鍵字"),
						deviceType: Joi.number().required().description("維護類型 - 1: 道路, 2: 熱再生, 3: 設施, 4: 標線")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { contractor, groupId, reportSN, keywords, deviceType } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_col = "";
				let sqlCMD_leftJoin = "";
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_restoreTable_col = 
							`caseRestoredAC.MillingDepth,
							caseRestoredAC.MillingLength,
							caseRestoredAC.MillingWidth,
							caseRestoredAC.MillingFormula,
							caseRestoredAC.MillingArea,`;
						
						sqlCMD_dType = 
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '1' 
							AND caseDistress.DeviceType <> '4' `;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_restoreTable_col =
							`caseRestoredHR.MillingDepth,
							caseRestoredHR.MillingLength,
							caseRestoredHR.MillingWidth,
							caseRestoredHR.MillingFormula,
							caseRestoredHR.MillingArea,`;

						sqlCMD_dType =
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '2' 
							AND caseDistress.DeviceType <> '5' `;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_restoreTable_col =
							`caseRestoredFA.IsPressing,
							caseRestoredFA.Notes,
							caseRestoredFA.TaskRealGroup,
							IFNULL(caseRestoredFA.KitNotes, JSON_OBJECT()) AS KitNotes,`;
						sqlCMD_dType = ` AND caseDistress.RoadType IN (2, 3) `;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_restoreTable_col = `caseRestoredMK.IsCancel,`;
						// sqlCMD_leftJoin = `LEFT JOIN caseRestoredAC ON caseRestoredAC.caseSID = caseRestoredMK.caseSID AND caseRestoredAC.IsActive = 1`;
						// sqlCMD_restoreTable_col = `caseRestoredAC.DateCompleted_At AS DateClose_AC, `;
						// sqlCMD_dType =
						// 	` AND caseList.sctype1flag NOT IN ( '2', '3' ) 
						// 	AND caseList.casesn <> '0' 
						// 	AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
						// 	AND markline.casecsn IS NOT NULL`;
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				let sqlCMD_filter = "";
				// if (tenderId.length != 0) sqlCMD_filter += ` AND caseDistress.BlockSN IN (SELECT SerialNo FROM tbl_Block WHERE DTeam = '${tenderId}') `;
				if (groupId != 0) sqlCMD_filter += ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE groupId = ${groupId}) `;
				if (reportSN.length != 0) sqlCMD_filter += ` AND caseDistress.CaseSucc = '${reportSN}' `;
				if (keywords.length != 0) sqlCMD_filter += ` AND caseDistress.Place LIKE '%${keywords}%' `;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.Postal_vil,
						${sqlCMD_restoreTable}.Contractor,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						caseDistress.DateDeadline,
						${sqlCMD_restoreTable_col}
						caseDistress.ImgZoomOut,
						caseDistress.DeviceType,
						deviceType.DName,
						distressType.DistressName,
						tenderBlock.TBName,
						caseType.casetype
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN tbl_Block AS tenderBlock ON caseDistress.BlockSN = tenderBlock.SerialNo
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1
						${sqlCMD_leftJoin}
					WHERE
						caseDistress.IsActive = 1
						AND caseDistress.State = 7
						AND ${sqlCMD_restoreTable}.OrderSN = '0'
						AND ${sqlCMD_restoreTable}.Contractor = ?
						${sqlCMD_dType}
						${sqlCMD_filter}
					ORDER BY ${sqlCMD_restoreTable}.DateCreate_At, ${sqlCMD_restoreTable}.OrderIndex`, [ contractor ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/jobTicketSort',
			options: {
				description: '派工單排序',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						'caseList[]': Joi.array().min(1).items(Joi.number().required().description("tbl_case SerialNo"))
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				let { 'caseList[]': caseList } = request.query;
				if (!Array.isArray(caseList)) caseList = [ caseList ];

				const [ result ] = await request.tendersql.pool.query(
					`SELECT 
						caseDistress.SerialNo AS SNFrom,
						caseDistress_1.SerialNo AS SNTo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.Place,
						ST_Distance(caseDistress.Coordinate, caseDistress_1.Coordinate) AS distance
					FROM 
						caseDistress,
						caseDistress AS caseDistress_1
					WHERE 
						caseDistress.SerialNo IN (?)
						AND caseDistress_1.SerialNo IN (?)
						AND caseDistress.SerialNo != caseDistress_1.SerialNo
					ORDER BY distance ASC`,
					[caseList, caseList]);

				let caseSortedRes = result;
				let caseSortedList = [ caseList[0] ];

				for(let i = 1; i < caseList.length; i++) {
					const caseFilter = caseSortedRes.filter(caseSpec => caseSpec.SNFrom == caseSortedList[i-1]);
					caseSortedList.push(caseFilter[0].SNTo);
					// console.log("caseSortedList: ", caseSortedList);
					caseSortedRes = caseSortedRes.filter(caseSpec => (
						caseSpec.SNFrom != caseFilter[0].SNFrom && caseSpec.SNTo != caseFilter[0].SNFrom
					));
					// console.log("caseSortedRes: ", caseSortedRes.map(c => ({ SNFrom: c.SNFrom, SNTo: c.SNTo })));
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: caseSortedList }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/jobConfirm',
			options: {
				description: '製作派工單(廠商確認)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						caseList: Joi.array().min(1).items(Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							OrderIndex: Joi.number().required().description("派工單排序")
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { contractor, deviceType, caseList } = request.payload;

				let sqlCMD_restoreTable = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				let orderSN = Number(DateTime.now().toFormat("yyyyMM001"));
				orderSN -= 191100000; //轉成民國年
				const [[ res_lastId ]] = await request.tendersql.pool.execute(
					`SELECT id AS lastId FROM caseOrder WHERE id >= ? ORDER BY id DESC LIMIT 1`,
					[ orderSN ]
				);
				orderSN = res_lastId ? Number(res_lastId.lastId) + 1 : orderSN;

				await request.tendersql.pool.execute(
					`INSERT INTO caseOrder (id, Contractor, OrderType, Creater) VALUES (?, ?, ?, ?)`,
					[ orderSN, contractor, deviceType, uid ]
				);

				for (const caseSpec of caseList) {
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET Contractor = ?, OrderSN = ?, OrderIndex = ? WHERE caseSID = ? AND IsActive = 1`,
						[ contractor, orderSN, caseSpec.OrderIndex, caseSpec.SerialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { orderSN }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/dispatch/revoke',
			options: {
				description: '派工退回',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						revokeType: Joi.number().default(1).description("退回類型- 1: 退回主任分派, 2: 退回廠商製作派工單"),
						revokeReason: Joi.string().allow('').default('').description("退回備註"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						serialNo: Joi.number().default(0).description("tbl_case SerialNo"),
						dispatchSN: Joi.number().default(0).description("派工單號")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { revokeType, revokeReason, deviceType, dispatchSN, serialNo } = request.payload;

				let sqlCMD_restoreTable = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				let serialNoArr = [];
				if (dispatchSN != 0) {
					const [ res_serialNo ] = await request.tendersql.pool.execute(
						`SELECT caseSID FROM ${sqlCMD_restoreTable} WHERE OrderSN = ? AND IsActive = 1`,
						[ dispatchSN ]
					);
					serialNoArr = res_serialNo.map(sid => sid.caseSID);
				} else if (serialNo != 0) serialNoArr.push(serialNo);
				
				if (serialNoArr.length == 0) return Boom.notAcceptable("Non-allow Parameters");

				let OrderSN = 0;
				if (revokeType == 1) {
					// revokeType == 1 退回主任 -> caseRestored disable
					await request.tendersql.pool.query(
						`UPDATE ${sqlCMD_restoreTable} SET IsActive = 0 WHERE caseSID IN (?) AND IsActive = 1`,
						[ serialNoArr ]
					);

					await request.tendersql.pool.query(
						`UPDATE caseDistress SET State = 11, StateNotes = ? WHERE SerialNo IN (?) AND IsActive = 1`,
						[revokeReason, serialNoArr ]
					);
				} else if (revokeType == 2) {
					// revokeType == 2 退回派工 -> caseRestored reset
					const [[ res_OrderSN ]] = await request.tendersql.pool.execute(
						`SELECT OrderSN FROM ${sqlCMD_restoreTable} WHERE caseSID = ? AND IsActive = 1`,
						[ serialNo ]
					);
					OrderSN = res_OrderSN.OrderSN;

					await request.tendersql.pool.query(
						`UPDATE ${sqlCMD_restoreTable} SET OrderSN = 0, OrderIndex = 0 WHERE caseSID IN (?) AND IsActive = 1`,
						[ serialNoArr ]
					);
				} 

				// 派工單caseOrder處理
				if (dispatchSN != 0) {
					// 整張disable
					await request.tendersql.pool.execute(
						`UPDATE caseOrder SET IsActive = 0 WHERE id = ? AND IsActive = 1`,
						[ dispatchSN ]
					);
				} else if (serialNo != 0) {
					// select 包含此案件編號的派工單
					const [ res_order ] = await request.tendersql.pool.execute(
						`SELECT 
							OrderSN,
							JSON_ARRAYAGG(caseSID) AS SNArray,
							SUM(IsActive) AS CaseSUM
						FROM ${sqlCMD_restoreTable}
						GROUP BY OrderSN
						HAVING JSON_CONTAINS(SNArray, ?, '$')`,
						[ String(serialNoArr[0]) ]
					);

					// console.log(res_order);

					if(res_order.length > 0) {
						for (const order of res_order) {
							if (order.CaseSUM == 0) {
								// 將caseOrder沒有案件數量 disable
								await request.tendersql.pool.execute(
									`UPDATE caseOrder SET IsActive = 0 WHERE id = ?`,
									[ order.OrderSN ]
								)
							} else {
								// caseOrder的案件重排序
								await request.tendersql.pool.execute(
									`UPDATE 
										${sqlCMD_restoreTable}
										INNER JOIN (
											SELECT 
												id,
												ROW_NUMBER() OVER ( ORDER BY OrderIndex ) AS OrderIndex_new
											FROM ${sqlCMD_restoreTable}
											WHERE IsActive = 1 AND OrderSN = ?
										) AS ${sqlCMD_restoreTable}_1 ON ${sqlCMD_restoreTable}_1.id = ${sqlCMD_restoreTable}.id
									SET OrderIndex = ${sqlCMD_restoreTable}_1.OrderIndex_new`,
									[ OrderSN == 0 ? order.OrderSN : OrderSN ]
								)
							}
						}
					}
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 修改派工單
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/jobTicketEdit',
			options: {
				description: '修改派工單',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						dispatchSN: Joi.number().required().description("派工單號"),
						caseList: Joi.array().min(1).items(Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							OrderIndex: Joi.number().required().description("派工單排序")
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { contractor, deviceType, dispatchSN, caseList } = request.payload;

				let sqlCMD_restoreTable = "";
				let restoredColArr = [ "caseSID" ];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						restoredColArr.push("IsMarking", "MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						restoredColArr.push("IsMarking", "MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						restoredColArr.push("IsPressing", "Notes", "TaskRealGroup", "KitNotes");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType");

				// Step1: 先disable
				const [ caseAssignList ] = await request.tendersql.pool.execute(
					`SELECT ${restoredColArr.join(",")} FROM ${sqlCMD_restoreTable} WHERE OrderSN = ? AND IsActive = 1`,
					[ dispatchSN ]
				);

				const serialNoArr = caseAssignList.map(caseSpec => caseSpec.caseSID);

				await request.tendersql.pool.query(
					`UPDATE ${sqlCMD_restoreTable} SET IsActive = 0 WHERE caseSID IN (?) AND IsActive = 1`, 
					[ serialNoArr ]
				);

				// await request.tendersql.pool.query(
				// 	`UPDATE caseDistress SET State = 11 WHERE SerialNo IN (?) AND IsActive = 1`,
				// [ serialNoArr ]
				// );

				await request.tendersql.pool.execute(
					`UPDATE caseOrder SET IsActive = 0 WHERE id = ? AND IsActive = 1`,
					[ dispatchSN ]
				);

				// Step2: 已派工案件重新建立
				for (const caseSpec of caseAssignList) {
					const valueStr = Object.values(caseSpec).map(val => {
						return (val instanceof Object || (typeof val).toLowerCase() == 'object')
							? `'${JSON.stringify(val)}'` : (val instanceof String || (typeof val).toLowerCase() == 'string') 
							? `'${val}'` : `${val}`;
					}).join(",");  

					await request.tendersql.pool.execute(
						`INSERT INTO ${sqlCMD_restoreTable} (Contractor, ${restoredColArr.join(",")}) VALUES (?, ${valueStr})`,
						[ contractor ]
					)
					// await request.tendersql.pool.execute(
					// 	`UPDATE caseDistress SET State = 7 WHERE SerialNo = ?`,
					// 	[ caseSpec.caseSID ]
					// );
				}
				
				// Step3: 重新建立派工單
				let orderSN = Number(DateTime.now().toFormat("yyyyMM001"));
				orderSN -= 191100000; //轉成民國年
				const [[ res_lastId ]] = await request.tendersql.pool.execute(
					`SELECT id AS lastId FROM caseOrder WHERE id >= ? ORDER BY id DESC LIMIT 1`,
					[ orderSN ]
				);
				orderSN = res_lastId ? Number(res_lastId.lastId) + 1 : orderSN;

				await request.tendersql.pool.execute(
					`INSERT INTO caseOrder (id, Contractor, OrderType, Creater) VALUES (?, ?, ?, NULL)`,
					[ orderSN, contractor, deviceType ]
				);

				for (const caseSpec of caseList) {
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET OrderSN = ?, OrderIndex = ? WHERE caseSID = ? AND IsActive = 1`,
						[ orderSN, caseSpec.OrderIndex, caseSpec.SerialNo ]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { orderSN }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 完工登錄
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/finRegister',
			options: {
				description: '完工登錄列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						dispatchSN: Joi.string().required().description("派工單號"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { contractor, dispatchSN, deviceType } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_col = "";
				let sqlCMD_leftJoin = "";
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_leftJoin =
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredAC.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredAC.IsMarking,
							IFNULL(caseDistress.Content, JSON_ARRAY()) AS Content,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							caseRestoredAC.MillingDepth,
							caseRestoredAC.MillingLength,
							caseRestoredAC.MillingWidth,
							caseRestoredAC.MillingFormula,
							caseRestoredAC.MillingArea,
							caseRestoredAC.uStacker,
							IFNULL(caseRestoredAC.uStackerImg, JSON_ARRAY()) AS uStackerImg,
							caseRestoredAC.uSprinkler,
							IFNULL(caseRestoredAC.uSprinklerImg, JSON_ARRAY()) AS uSprinklerImg,
							caseRestoredAC.uDigger,
							IFNULL(caseRestoredAC.uDiggerImg, JSON_ARRAY()) AS uDiggerImg,
							caseRestoredAC.uRoller,
							IFNULL(caseRestoredAC.uRollerImg, JSON_ARRAY()) AS uRollerImg,
							caseRestoredAC.uPaver,
							IFNULL(caseRestoredAC.uPaverImg, JSON_ARRAY()) AS uPaverImg,
							caseRestoredAC.uNotes,
							caseRestoredAC.Aggregate34,
							caseRestoredAC.Aggregate38,
							caseRestoredAC.SamplingL1,
							IFNULL(caseRestoredAC.SamplingL1Detail, JSON_OBJECT()) AS SamplingL1Detail,
							caseRestoredAC.SamplingL2,
							IFNULL(caseRestoredAC.SamplingL2Detail, JSON_OBJECT()) AS SamplingL2Detail,
							IFNULL(caseRestoredAC.UnderConstrImg, JSON_ARRAY()) AS UnderConstrImg,
							IFNULL(caseRestoredAC.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,`;
						
						sqlCMD_dType = 
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '1' `;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_leftJoin =
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredHR.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredHR.IsMarking,
							IFNULL(caseDistress.Content, JSON_ARRAY()) AS Content,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							caseRestoredHR.MillingDepth,
							caseRestoredHR.MillingLength,
							caseRestoredHR.MillingWidth,
							caseRestoredHR.MillingFormula,
							caseRestoredHR.MillingArea,
							caseRestoredHR.uStacker,
							IFNULL(caseRestoredHR.uStackerImg, JSON_ARRAY()) AS uStackerImg,
							caseRestoredHR.uSprinkler,
							IFNULL(caseRestoredHR.uSprinklerImg, JSON_ARRAY()) AS uSprinklerImg,
							caseRestoredHR.uDigger,
							IFNULL(caseRestoredHR.uDiggerImg, JSON_ARRAY()) AS uDiggerImg,
							caseRestoredHR.uRoller,
							IFNULL(caseRestoredHR.uRollerImg, JSON_ARRAY()) AS uRollerImg,
							caseRestoredHR.uPaver,
							IFNULL(caseRestoredHR.uPaverImg, JSON_ARRAY()) AS uPaverImg,
							caseRestoredHR.uNotes,
							IFNULL(caseRestoredHR.UnderConstrImg, JSON_ARRAY()) AS UnderConstrImg,
							IFNULL(caseRestoredHR.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,`;
						sqlCMD_dType = 
							` AND caseDistress.RoadType = '1'  
							AND caseDistress.RestoredType = '2' `;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_leftJoin =
							`LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = caseRestoredFA.caseSID AND caseRestoredMK.IsActive = 1
							LEFT JOIN caseOrder AS caseOrder_MK ON caseRestoredMK.OrderSN = caseOrder_MK.id`;
						sqlCMD_restoreTable_col =
							`caseRestoredFA.IsMarking,
							IFNULL(caseDistress.Content, JSON_ARRAY()) AS Content,
							caseRestoredMK.Contractor AS Contractor_MK,
							caseRestoredMK.OrderSN AS OrderSN_MK,
							caseRestoredMK.IsCancel AS IsCancel_MK,
							caseRestoredMK.DateCreate_At AS DatePlan_MK,
							caseOrder_MK.DateCreate_At AS DateAssign_MK,
							caseOrder_MK.DateCompleted_At AS DateClose_MK,
							caseRestoredFA.IsPressing,
							caseRestoredFA.Notes,
							caseDistress.TaskRealGroup AS TaskRealGroup_Plan,
							caseRestoredFA.TaskRealGroup,
							IFNULL(caseDistress.KitNotes, JSON_OBJECT()) AS KitNotes_Plan,
							IFNULL(caseRestoredFA.KitNotes, JSON_OBJECT()) AS KitNotes,
							IFNULL(caseRestoredFA.PostConstrImg, JSON_ARRAY()) AS PostConstrImg,
							IFNULL(caseRestoredFA.Image, JSON_OBJECT()) AS Image,`;
						sqlCMD_dType = ` AND caseDistress.RoadType IN (2, 3) `;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_restoreTable_col = 
							`caseRestoredMK.IsCancel,
							IFNULL(caseRestoredMK.Content, JSON_ARRAY()) AS Content,
							JSON_EXTRACT(Content, '$[*].MillingArea') AS MillingAreaArr,
							IFNULL(caseRestoredMK.MarkingImg, JSON_ARRAY()) AS MarkingImg,`;
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				// 將caseOrder沒有案件數量的IsActive設為0
				await request.tendersql.pool.execute(
					`UPDATE
						caseOrder
						INNER JOIN (
							SELECT 
								OrderSN,
								JSON_ARRAYAGG(caseSID) AS SNArray,
								SUM(IsActive) AS CaseSUM
							FROM ${sqlCMD_restoreTable}
							WHERE OrderSN = ?
							GROUP BY OrderSN
						) AS ${sqlCMD_restoreTable} ON caseOrder.Id = ${sqlCMD_restoreTable}.OrderSN
					SET IsActive = ${sqlCMD_restoreTable}.CaseSUM > 0`,
					[ dispatchSN ]
				)

				const [result] = await request.tendersql.pool.execute(
					`SELECT
						${sqlCMD_restoreTable}.OrderSN,
						${sqlCMD_restoreTable}.OrderIndex,
						caseDistress.SerialNo,
						caseDistress.CaseSN,
						caseDistress.CaseNo,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistressApply.GroupId,
						tenderBlock.DTeam,
						caseDistress.Postal_vil,
						${sqlCMD_restoreTable}.Contractor,
						caseDistress.Place,
						caseDistress.CoordinateX,
						caseDistress.CoordinateY,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						caseDistress.DateDeadline,
						caseOrder.Creater,
						${sqlCMD_restoreTable}.DateCompleted_At AS DateRecord,
						caseOrder.DateCompleted_At AS DateClose,
						${sqlCMD_restoreTable_col}
						caseDistress.ImgZoomOut,
						caseDistress.DeviceType,
						deviceType.DName,
						distressType.DistressName,
						tenderBlock.TBName,
						caseType.casetype,
						${sqlCMD_restoreTable}.DateCompleted_At IS NOT NULL AS IsCompleted,
						caseOrder.DateCompleted_At IS NOT NULL AS IsAllCompleted		
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN tbl_Block AS tenderBlock ON caseDistress.BlockSN = tenderBlock.SerialNo
						LEFT JOIN caseDistressApply ON caseDistressApply.id = caseDistress.ApplyId
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1
						LEFT JOIN caseOrder ON ${sqlCMD_restoreTable}.OrderSN = caseOrder.id
						${sqlCMD_leftJoin}
					WHERE
						caseDistress.IsActive = 1
						AND ${sqlCMD_restoreTable}.Contractor = ?
						AND ${sqlCMD_restoreTable}.OrderSN = ?
						${sqlCMD_dType}
					ORDER BY ${sqlCMD_restoreTable}.OrderSN, ${sqlCMD_restoreTable}.OrderIndex`, 
					[ contractor, dispatchSN ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/finImgUpload',
			options: {
				description: '修改完工圖片',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						serialNo: Joi.number().required().description("tbl_case SerialNo"),
						imgColKey: Joi.string().default('').description("照片欄位Key"),
						imgId: Joi.number().default(0).description("照片Id"),
						fileAddList: Joi.alternatives().try(Joi.any().meta({ swaggerType: "file" }), Joi.array().items(Joi.any().meta({ swaggerType: "file" }))).default([]).description("圖片上傳列表(RAW)"),
						fileRemoveList: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).default([]).description("圖片刪除列表(url)"),
					}).error(err => console.log(err))
				},  // POST
				payload: {
					output: "stream",
					allow: "multipart/form-data",
					multipart: true
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;

				// imgColKey - 照片獨立欄位; imgId - Image欄位(JSON紀錄)
				// param 參數
				const { deviceType, serialNo, imgColKey, imgId } = request.payload;
				let { fileAddList, fileRemoveList } = request.payload;
				if (!Array.isArray(fileAddList)) fileAddList = [ fileAddList ];
				if (!Array.isArray(fileRemoveList)) fileRemoveList = [ fileRemoveList ];

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_imgColKey = [];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_restoreTable_imgColKey.push("uStacker", "uDigger", "uPaver", "uRoller", "uSprinkler", "UnderConstr", "PostConstr");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_restoreTable_imgColKey.push("uStacker", "uDigger", "uPaver", "uRoller", "uSprinkler", "UnderConstr", "PostConstr");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_restoreTable_imgColKey.push("PostConstr");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_restoreTable_imgColKey.push("Marking");
						break;
				}
				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType");

				let destFileName = "";
				let sqlCMD_restoreTable_col = "";
				if (imgColKey.length != 0) {
					// 驗證欄位
					sqlCMD_restoreTable_col = `${imgColKey}Img`;
					if (sqlCMD_restoreTable_imgColKey.includes(imgColKey)) destFileName = `restored_reporter/${serialNo}_${imgColKey}_`;
					else return Boom.notAcceptable("Non-Accepted imgColKey");

				} else if (imgId != 0) {
					const [[ res_restoredImg ]] = await request.tendersql.pool.execute(
						`SELECT EngName FROM caseRestoredImg WHERE Id = ? AND IsActive = 1`,
						[ imgId ]);
					
					// 驗證Id
					sqlCMD_restoreTable_col = `Image`;
					if (res_restoredImg.EngName) destFileName = `restored_reporter/${serialNo}_${res_restoredImg.EngName}_`;
					else return Boom.notAcceptable("Non-Accepted imgId");
				}

				// 移除圖片
				for (const url of fileRemoveList) {
					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} 
						SET ${sqlCMD_restoreTable_col} = JSON_REMOVE(${sqlCMD_restoreTable_col}, JSON_UNQUOTE(JSON_SEARCH(${sqlCMD_restoreTable_col}, 'all', ?))), DateCompleted_At = NOW() 
						WHERE caseSID = ? AND IsActive = 1`,
						[ url, serialNo ]
					);
					
					// 若無照片，則刪除JSON的Key
					if (imgId != 0) {
						await request.tendersql.pool.execute(
							`UPDATE ${sqlCMD_restoreTable} 
							SET ${sqlCMD_restoreTable_col} = JSON_REMOVE(${sqlCMD_restoreTable_col}, '$."${imgId}"')
							WHERE JSON_LENGTH(${sqlCMD_restoreTable_col}, '$."${imgId}"') = 0`
						);
					}

					// 紀錄被刪除圖片
					await request.tendersql.pool.execute(
						`INSERT INTO removeImgUrl (ImgUrl, OperatorId) VALUES (?, ?)`,
						[ url, uid ]
					);
				}

				// 照片上傳至GCP
				server.methods.setBucket('adm_distress_image');
				await server.methods.getFileList(destFileName).then(async (existFileList) => {
					for (const [index, file] of fileAddList.entries()) {
						// const fileExtension = file.hapi.filename.split(".").slice(-1);
						const { ext } = parse(file.hapi.filename);
						const destFileNameSpec = `${destFileName}_${existFileList.length + index + 1}${ext}`;
						try {
							await server.methods.uploadFile(file._data, destFileNameSpec).then(async (publicUrl) => {
								if (imgColKey.length != 0) {
									await request.tendersql.pool.execute(
										`UPDATE ${sqlCMD_restoreTable} SET ${sqlCMD_restoreTable_col} = JSON_ARRAY_APPEND(COALESCE(${sqlCMD_restoreTable_col}, '[]'), '$', ?), DateCompleted_At = NOW() WHERE caseSID = ? AND IsActive = 1`,
										[decodeURIComponent(publicUrl), serialNo]
									);
								} else if (imgId != 0) {
									await request.tendersql.pool.execute(
										`UPDATE ${sqlCMD_restoreTable} SET ${sqlCMD_restoreTable_col} = JSON_ARRAY_APPEND(JSON_INSERT(COALESCE(${sqlCMD_restoreTable_col}, '{}'), '$."${imgId}"', JSON_ARRAY()), '$."${imgId}"', ?), DateCompleted_At = NOW() WHERE caseSID = ? AND IsActive = 1`,
										[decodeURIComponent(publicUrl), serialNo]
									);
								}
							}).catch(err => {
								console.log(err);
								const errString = typeof err == "String" ? err : "Upload fail!";
								return Boom.notAcceptable(errString);
							});
						} catch (err) { console.log(err) }
					}
				}).catch(err => console.log(err));

				const [[ res_imgList ]] = await request.tendersql.pool.execute(
					`SELECT ${sqlCMD_restoreTable_col} FROM ${sqlCMD_restoreTable} WHERE caseSID = ? AND IsActive = 1`,
					[ serialNo ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					imgList: res_imgList[sqlCMD_restoreTable_col]
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/finRegister',
			options: {
				description: '完工登錄',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						orderSN: Joi.number().required().description("caseOrder id"),
						caseList: Joi.array().min(1).items(Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							IsMarking: Joi.number().allow(0, 1).default(0).description("是否加繪標線"),
							Content: Joi.string().default('[]').description("標線項目"),
							MillingLength: Joi.number().default(0).description("實際長度"),
							MillingWidth: Joi.number().default(0).description("實際寬度"),
							MillingDepth: Joi.number().default(0).description("實際深度"),
							MillingFormula: Joi.string().default('0').description("實際複雜算式"),
							MillingArea: Joi.number().default(0).description("實際面積"),
							Notes: Joi.string().allow('').default('').description("備註(c5type)"),
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { deviceType, orderSN, caseList } = request.payload;

				let sqlCMD_restoreTable = "";
				let restoredColArr = [];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						restoredColArr.push("MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						restoredColArr.push("Notes");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				for (const caseSpec of caseList) {
					let restoredUpdateStr = restoredColArr.map(col => {
						return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
							? `${col} = '${caseSpec[col]}'` : `${col} = ${caseSpec[col]}`;
					}).join(",");

					if (restoredUpdateStr.length > 0) restoredUpdateStr += ",";

					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET ${restoredUpdateStr} DateCompleted_At = NOW() WHERE caseSID = ? AND IsActive = 1`,
						[ caseSpec.SerialNo ]
					)

					// 「補繪標線」派工給「倢立」
					if (deviceType != 4 && caseSpec.IsMarking == 1) {
						const [[{ GuildCode }]] = await request.accsql.pool.execute(`SELECT GuildCode, Name FROM guilds WHERE Name = '倢立'`);

						// 確認是否已建立「補繪標線」派工
						const [ res_caseSpec ] = await request.tendersql.pool.execute(
							`SELECT
								${sqlCMD_restoreTable}.caseSID,
								caseRestoredMK.OrderSN
							FROM
								${sqlCMD_restoreTable}
								LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = ${sqlCMD_restoreTable}.caseSID AND caseRestoredMK.IsActive = 1 
							WHERE
								${sqlCMD_restoreTable}.caseSID = ?
								AND ${sqlCMD_restoreTable}.IsActive = 1
								AND caseRestoredMK.OrderSN IS NOT NULL`,
							[ caseSpec.SerialNo ]
						)

						if (res_caseSpec.length > 0) continue;

						await request.tendersql.pool.execute(
							`INSERT INTO caseRestoredMK (caseSID, Contractor, Content) VALUES (?, ?, ?)`,
							[ caseSpec.SerialNo, GuildCode, caseSpec.Content ]
						)
						await request.tendersql.pool.execute(
							`UPDATE ${sqlCMD_restoreTable} SET IsMarking = ? WHERE caseSID = ? AND IsActive = 1`,
							[ caseSpec.IsMarking, caseSpec.SerialNo ]
						);
					}
				}

				await request.tendersql.pool.execute(`UPDATE caseOrder SET DateCompleted_At = NOW() WHERE id = ? AND IsActive = 1`, [ orderSN ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/dispatch/finRegisterSpec',
			options: {
				description: '單筆資料登錄',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						caseSpec: Joi.object({
							SerialNo: Joi.number().required().description("tbl_case SerialNo"),
							IsMarking: Joi.number().allow(0, 1).default(0).description("是否加繪標線"),
							MillingLength: Joi.number().default(0).description("實際長度"),
							MillingWidth: Joi.number().default(0).description("實際寬度"),
							MillingDepth: Joi.number().default(0).description("實際深度"),
							MillingFormula: Joi.string().default('0').description("實際複雜算式"),
							MillingArea: Joi.number().default(0).description("實際面積"),
							uStacker: Joi.number().default(0).description("堆高機(時數)"),
							uSprinkler: Joi.number().default(0).description("灑水車(時數)"),
							uDigger: Joi.number().default(0).description("挖土機(時數)"),
							uRoller: Joi.number().default(0).description("壓路機(時數)"),
							uPaver: Joi.number().default(0).description("鋪裝機(時數)"),
							uNotes: Joi.string().allow('').default('').description("機具使用備註"),
							Aggregate34: Joi.number().default(0).description("3/4粒料用量"),
							Aggregate38: Joi.number().default(0).description("3/8粒料用量"),
							SamplingL1: Joi.number().allow(0, 1).default(0).description("一級抽料: 是否使用"),
							SamplingL1Detail: Joi.string().default('{}').description("一級抽料詳細"),
							SamplingL2: Joi.number().allow(0, 1).default(0).description("二級抽料: 是否使用"),
							SamplingL2Detail: Joi.string().default('{}').description("二級抽料詳細"),
							Notes: Joi.string().allow('').default('').description("備註(c5type)"),
							Content: Joi.string().default('[]').description("標線項目"),
							TaskRealGroup: Joi.number().default(0).description("TaskReal SerialNo"),
							KitContent: Joi.array().default([]).items(
								Joi.object({
									GroupSN: Joi.number().default(0).description("組套序號"),
									UnitSN: Joi.string().required().description("項次"),
									TaskName: Joi.string().required().description("工程項目"),
									TaskUnit: Joi.string().required().description("單位"),
									number: Joi.number().default(0).description("數量"),
									TaskPrice: Joi.number().default(0).description("單價"),
									DTeam: Joi.string().required().description("合約")
								})
							).description("計價套組項目"),
							KitNotes: Joi.string().default('{}').description("計價套組備註")
						})
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { deviceType, caseSpec } = request.payload;

				let sqlCMD_restoreTable = "";
				let restoredColArr = [];
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						restoredColArr.push("IsMarking", "MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea", "uStacker", "uSprinkler", "uDigger", "uRoller", "uPaver", "uNotes", "Aggregate34", "Aggregate38", "SamplingL1", "SamplingL1Detail", "SamplingL2", "SamplingL2Detail");
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						restoredColArr.push("IsMarking", "MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea", "uStacker", "uSprinkler", "uDigger", "uRoller", "uPaver", "uNotes");
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						restoredColArr.push("IsMarking", "Notes", "KitNotes");
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						restoredColArr.push("Content");
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				// 寫入設施套組(實際)
				if (deviceType == 3 && caseSpec.KitContent.length > 0) {
					// 比對套組是否相等
					let isSame = true;
					const [ res_task ] = await request.tendersql.pool.execute(
						`SELECT 
							GroupSN, UnitSN, TaskName, TaskUnit, TaskPrice, TaskNumber AS number,DTeam
						FROM
							TaskReal
						WHERE
							TaskReal.GroupId = ? AND TaskReal.IsActive = 1`,
						[ caseSpec.TaskRealGroup ]);

					const taskOriArray = res_task.sort((a, b) => a.UnitSN - b.UnitSN);
					const taskNewArray = caseSpec.KitContent.sort((a, b) => a.UnitSN - b.UnitSN);
					if (taskOriArray.length !== taskNewArray.length) isSame = false;
					else {
						for (const index in taskOriArray) {
							if (!tools.objCompare(taskOriArray[index], taskNewArray[index])) isSame = false;
						}
					}

					if(!isSame) {
						// 先將之前的欄位disable
						// await request.tendersql.pool.execute(
						// 	`UPDATE TaskReal SET IsActive = 0 WHERE GroupId = ?`,
						// 	[ caseSpec.TaskRealGroup ]
						// );

						const [[res_lastGroupId]] = await request.tendersql.pool.execute(
							`SELECT GroupId AS lastGroupId FROM TaskReal ORDER BY GroupId DESC LIMIT 1`
						);
						caseSpec.TaskRealGroup = res_lastGroupId ? Number(res_lastGroupId.lastGroupId) + 1 : 1;
						restoredColArr.push("TaskRealGroup");

						for (const kit of caseSpec.KitContent) {
							const taskRealColStr = Object.keys(kit).map(key => key.replace("number", "TaskNumber")).join(",");
							const taskRealValStr = Object.values(kit).map(val => {
								return (val instanceof String || (typeof val).toLowerCase() == 'string') ? `'${val}'` : `${val}`;
							}).join(",");

							await request.tendersql.pool.execute(
								`INSERT INTO TaskReal ( GroupId, caseSID, ${taskRealColStr} ) VALUES ( ?, ?, ${taskRealValStr} )`,
								[ caseSpec.TaskRealGroup, caseSpec.SerialNo ]
							);
						}
					}
				}

				const restoredUpdateStr = restoredColArr.map(col => {
					return (caseSpec[col] instanceof String || (typeof caseSpec[col]).toLowerCase() == 'string') && caseSpec[col].indexOf('"') != 0
						? `${col} = '${caseSpec[col]}'` : `${col} = ${caseSpec[col]}`;
				}).join(",");

				await request.tendersql.pool.execute(
					`UPDATE ${sqlCMD_restoreTable} SET ${restoredUpdateStr}, DateCompleted_At = NOW() WHERE caseSID = ? AND IsActive = 1`,
					[ caseSpec.SerialNo ]
				)

				// 「補繪標線」派工給「倢立」
				// if (deviceType != 4 && caseSpec.IsMarking == 1) {
				// 	// 確認是否已建立「補繪標線」派工
				// 	const [ res_caseSpec ] = await request.tendersql.pool.execute(
				// 		`SELECT
				// 				${sqlCMD_restoreTable}.caseSID,
				// 				caseRestoredMK.OrderSN
				// 			FROM
				// 				${sqlCMD_restoreTable}
				// 				LEFT JOIN caseRestoredMK ON caseRestoredMK.caseSID = ${sqlCMD_restoreTable}.caseSID AND caseRestoredMK.IsActive = 1 
				// 			WHERE
				// 				${sqlCMD_restoreTable}.caseSID = ?
				// 				AND ${sqlCMD_restoreTable}.IsActive = 1
				// 				AND caseRestoredMK.OrderSN IS NOT NULL`,
				// 		[ caseSpec.SerialNo ]
				// 	)

				// 	if (res_caseSpec.length > 0) return { statusCode: 20000, message: 'successful' };

				// 	await request.tendersql.pool.execute(
				// 		`INSERT INTO caseRestoredMK (caseSID, Contractor) VALUES (?, ?)`,
				// 		[ caseSpec.SerialNo, 3004 ]
				// 	)

				// 	await request.tendersql.pool.execute(
				// 		`UPDATE ${sqlCMD_restoreTable} SET IsMarking = ? WHERE caseSID = ? AND IsActive = 1`,
				// 		[ caseSpec.IsMarking, caseSpec.SerialNo ]
				// 	);
				// }

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/dispatch/cancel',
			options: {
				description: '標記為不需施作',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						serialNo: Joi.number().default(0).description("tbl_case SerialNo"),
						isCancel: Joi.number().allow(0, 1).default(1).description("是否標記「無需施工」"),
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { deviceType, serialNo, isCancel } = request.payload;

				// TODO: 目前只開放「標線」
				let sqlCMD_restoreTable = "";
				switch (deviceType) {
					// case 1: // 道路
					// 	sqlCMD_restoreTable = "caseRestoredAC";
					// 	break;
					// case 2:	// 熱再生
					// 	sqlCMD_restoreTable = "caseRestoredHR";
					// 	break;
					// case 3:	// 設施
					// 	sqlCMD_restoreTable = "caseRestoredFA";
					// 	break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				// 紀錄被刪除圖片
				const [[ res_markingImg ]] = await request.tendersql.pool.execute(
					`SELECT MarkingImg FROM ${sqlCMD_restoreTable} WHERE caseSID = ? AND IsActive = 1`,
					[ serialNo ]
				);
				// console.log(res_markingImg);

				if (res_markingImg.MarkingImg) {
					for (const url of res_markingImg.MarkingImg) {
						await request.tendersql.pool.execute(
							`INSERT INTO removeImgUrl (ImgUrl, OperatorId) VALUES (?, ?)`,
							[url, uid]
						);
					}	
				}

				await request.tendersql.pool.execute(
					`UPDATE ${sqlCMD_restoreTable} SET IsCancel = ?, DateCompleted_At = NOW(), Content = JSON_ARRAY(), MarkingImg = JSON_ARRAY() WHERE caseSID = ? AND IsActive = 1`,
					[ isCancel, serialNo ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工管理 - 派工單管理
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/jobTicketList',
			options: {
				description: '派工單列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已刪除」"),
						contractor: Joi.number().required().description("施工廠商 guildCode"),
						dispatchSN: Joi.string().allow('').default('').description("派工單號"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, contractor, dispatchSN, deviceType, timeStart, timeEnd } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_dType =
							` AND caseDistress.RoadType = '1' 
							AND caseDistress.RestoredType = '1' `;
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_dType =
							` AND caseDistress.RoadType = '1'  
							AND caseDistress.RestoredType = '2' `;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_dType = ` AND caseDistress.RoadType IN (2, 3) `;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				// 將caseOrder沒有案件數量的IsActive設為0
				await request.tendersql.pool.execute(
					`UPDATE
						caseOrder
						INNER JOIN (
							SELECT 
								OrderSN,
								JSON_ARRAYAGG(caseSID) AS SNArray,
								SUM(IsActive) AS CaseSUM
							FROM ${sqlCMD_restoreTable}
							GROUP BY OrderSN
						) AS ${sqlCMD_restoreTable} ON caseOrder.Id = ${sqlCMD_restoreTable}.OrderSN
					SET IsActive = ${sqlCMD_restoreTable}.CaseSUM > 0`,
				)

				let sqlCMD_filter = filter ? ` WHERE IsActive = 0 ` : ` WHERE IsActive = 1 `;
				if (dispatchSN.length != 0) sqlCMD_filter += ` AND caseOrder.id = '${dispatchSN}' `;
				else sqlCMD_filter += ` AND caseOrder.DateCreate_At >= '${timeStart}' AND caseOrder.DateCreate_At < '${timeEnd}'`;
				
				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						caseOrder.id AS OrderSN,
						caseOrder.Contractor,
						caseOrder.OrderType,
						caseOrder.Creater,
						caseOrder.Amount,
						IFNULL(caseDistress.CaseNoActiveArr, JSON_ARRAY()) AS CaseNoActiveArr,
						IFNULL(caseDistress.CaseNoInActiveArr, JSON_ARRAY()) AS CaseNoInActiveArr,
						caseOrder.DateCreate_At AS DateAssign,
						IFNULL(caseOrder.DateCompleted_At, '') AS DateClose,
						caseOrder.IsActive
					FROM
						(
							SELECT
								${sqlCMD_restoreTable}.OrderSN,
								JSON_ARRAYAGG(CASE WHEN ${sqlCMD_restoreTable}.IsActive = 1 THEN caseDistress.CaseNo ELSE 0 END) AS CaseNoActiveArr,
								JSON_ARRAYAGG(CASE WHEN ${sqlCMD_restoreTable}.IsActive = 0 THEN caseDistress.CaseNo ELSE 0 END) AS CaseNoInActiveArr
							FROM
								caseDistress
								LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID
							WHERE
								caseDistress.IsActive = 1
								AND ${sqlCMD_restoreTable}.Contractor = ?
								${sqlCMD_dType}
							GROUP BY ${sqlCMD_restoreTable}.OrderSN
						) AS caseDistress 
						LEFT JOIN caseOrder ON caseDistress.OrderSN = caseOrder.id
						${sqlCMD_filter}
						ORDER BY caseOrder.id`,
					[ contractor ]);

					if(deviceType == 4) {
						const [ res_caseIsCancel ] = await request.tendersql.pool.execute(
							`SELECT
								caseRestoredMK.OrderSN,
								JSON_ARRAYAGG(caseRestoredMK.IsCancel) AS CaseIsCancelArr
							FROM caseRestoredMK
							WHERE
								caseRestoredMK.IsActive = 1
								AND caseRestoredMK.Contractor = ?
							GROUP BY caseRestoredMK.OrderSN`,
							[ contractor ]);
						result.forEach(caseRes => { 
							caseRes.CaseIsCancelArr = res_caseIsCancel.filter(caseCancel => caseCancel.OrderSN == caseRes.OrderSN)[0].CaseIsCancelArr;
						});
					}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatch/jobTicketSpec',
			options: {
				description: '派工單詳細(補印派工單)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						dispatchSN: Joi.string().allow('').default('').description("派工單號"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dispatchSN, deviceType } = request.query;

				let sqlCMD_restoreTable = "";
				let sqlCMD_restoreTable_col = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_restoreTable = "caseRestoredAC";
						sqlCMD_restoreTable_col =
							`caseRestoredAC.MillingDepth,
							caseRestoredAC.MillingLength,
							caseRestoredAC.MillingWidth,
							caseRestoredAC.MillingFormula,
							caseRestoredAC.MillingArea,`;
						
						break;
					case 2:	// 熱再生
						sqlCMD_restoreTable = "caseRestoredHR";
						sqlCMD_restoreTable_col =
							`caseRestoredHR.MillingDepth,
							caseRestoredHR.MillingLength,
							caseRestoredHR.MillingWidth,
							caseRestoredHR.MillingFormula,
							caseRestoredHR.MillingArea,`;
						break;
					case 3:	// 設施
						sqlCMD_restoreTable = "caseRestoredFA";
						sqlCMD_restoreTable_col =
							`caseRestoredFA.IsPressing,
							caseRestoredFA.Notes,
							caseDistress.TaskRealGroup,
							IFNULL(caseRestoredFA.KitNotes, JSON_OBJECT()) AS KitNotes,`;
						break;
					case 4:	// 標線
						sqlCMD_restoreTable = "caseRestoredMK";
						sqlCMD_restoreTable_col = `caseRestoredMK.IsCancel,`;
						break;
				}

				// 阻擋其他類型
				if (sqlCMD_restoreTable.length == 0) return Boom.notAcceptable("Non-Accepted deviceType"); 

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						${sqlCMD_restoreTable}.OrderSN,
						${sqlCMD_restoreTable}.OrderIndex,
						caseDistress.CaseNo,
						caseDistress.CaseSN,
						caseDistress.Postal_vil,
						caseDistress.Place,
						${sqlCMD_restoreTable}.DateCreate_At AS DatePlan,
						caseDistress.DateDeadline,
						${sqlCMD_restoreTable_col}
						caseDistress.ImgZoomOut,
						deviceType.DName,
						distressType.DistressName	
					FROM
						caseDistress
						LEFT JOIN tbl_CaseType AS caseType ON caseDistress.CaseType = caseType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseDistress.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_DistressType AS distressType ON caseDistress.DistressType = distressType.SerialNo
						LEFT JOIN ${sqlCMD_restoreTable} ON caseDistress.SerialNo = ${sqlCMD_restoreTable}.caseSID AND ${sqlCMD_restoreTable}.IsActive = 1
						LEFT JOIN caseOrder ON ${sqlCMD_restoreTable}.OrderSN = caseOrder.id
					WHERE
						caseDistress.IsActive = 1
						AND ${sqlCMD_restoreTable}.OrderSN = ?
					ORDER BY ${sqlCMD_restoreTable}.OrderIndex`,
					[ dispatchSN ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/dispatch/jobTicketAmt',
			options: {
				description: '修改派工單金額',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						orderSN: Joi.number().required().description("caseOrder id"),
						amount: Joi.number().required().description("總金額")
					}).error((err) => console.log(err))
				}   // PUT
			},
			handler: async function (request, h) {
				const { orderSN, amount } = request.payload;

				await request.tendersql.pool.execute(
					`UPDATE caseOrder SET Amount = ? WHERE id = ?`,
					[amount, orderSN]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/dispatch/unFinRegister',
			options: {
				description: '解除完工登錄',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						orderSN: Joi.number().required().description("caseOrder id")
					}).error((err) => console.log(err))
				}   // PUT
			},
			handler: async function (request, h) {
				const { orderSN } = request.payload;

				await request.tendersql.pool.execute(
					`UPDATE caseOrder SET DateCompleted_At = NULL WHERE id = ?`,
					[ orderSN ]);

				const [ res_orderType ] = await request.tendersql.pool.execute(
					`SELECT OrderType FROM caseOrder WHERE id = ?`,
					[ orderSN ]);

				if (res_orderType.length != 0) {
					let sqlCMD_restoreTable = "";
					switch (res_orderType[0].OrderType) {
						case 1: // 道路
							sqlCMD_restoreTable = "caseRestoredAC";
							break;
						case 2:	// 熱再生
							sqlCMD_restoreTable = "caseRestoredHR";
							break;
						case 3:	// 設施
							sqlCMD_restoreTable = "caseRestoredFA";
							break;
						case 4:	// 標線
							sqlCMD_restoreTable = "caseRestoredMK";
							break;
					}

					await request.tendersql.pool.execute(
						`UPDATE ${sqlCMD_restoreTable} SET DateCompleted_At = NULL WHERE OrderSN = ?`,
						[ orderSN ]);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		/* Router End */
	},
};
