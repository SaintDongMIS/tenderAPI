'use strict';

const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const AuthBearer = require('hapi-auth-bearer-token');

const cryptiles = require('@hapi/cryptiles');
const bcrypt = require('bcrypt');

const permitObj = {
	// 管理權限
	rAdm: {
		0: 1
	},
	// 測試頁面
	beta : {
		0: 1
	},
	// 單元管理
	uBlock: {
		viewer: 1,
		manager: 8
	},
	// 巡查管理
	inspection: {
		viewer: 1,
		marker: 2,
		editor: 4,
		master: 8
	},
	// 缺失管理
	distress: {
		viewer: 1,
		inspector: 2,
		inspectorMap: 4,
		inspectorMaster: 8
	},
	// PCI管理
	PCIManage: {
		base: 1,
		master: 8
	},
	// 案件
	case: {
		viewer: 1,
	},
	// 派工
	restored: {
		viewer: 1, //派工單管理
		assign: 2, //主任分派
		order: 4, //製作派工單
		reporter: 8 //完工登錄
	},
	// 計價管理
	Pricing: {
		viewer: 1
	},
	// 成效指標 PI
	PIcase: {
		viewer: 1,
		inspector: 2, // 監造
		supervisor: 4, // 機關
		editor: 8,
		analyst: 16
	},
	PIreport: {
		daily: 1,
		weekly: 2,
		monthly: 4
	},
	PCIanalyst: {
		viewer: 1
	},
	// 其他
	other: {
		weather: 1
	},
	// 車巡管理
	car: {
		viewer: 1,
		route: 2,
		marker: 4
	},
	// APP
	app: {
		inspector: 1
	}
}

const getPermit = function(roles) {
	let permit = [];

	for (const i of roles) {
		for (const authKey of Object.keys(permitObj)) {
			if(i.AuthKey == authKey) {
				permit.push(authKey);
				for(const subKey of Object.keys(permitObj[authKey])) {
					if (subKey != '0' && i.Value & permitObj[authKey][subKey]) permit.push(`${authKey}.${subKey}`);
				}
			}
		}
	}

	return permit
}

exports.plugin = {
	name: 'auth_pg',
	version: '1.0.0',
	register: async function (server, options) {
		// 存放 Login token 的 cached (PostgreSQL版本)
		
		const cachedLogin = server.cache({
			expiresIn: process.env.CACHE_LOGIN_EXPIRE || 86400000,
			// cache: 'redisCache',
			segment: 'accessToken_pg',  // 使用不同的segment名稱避免衝突
			generateFunc: async (token) => {
				const info = { init: false, roles: [] };
				return info;
			},
			generateTimeout: 2000,
		});
		

		// 檢查是否已經註冊了AuthBearer插件
		try {
			await server.register(AuthBearer);
		} catch (error) {
			// 如果已經註冊了，忽略錯誤
			if (!error.message.includes('already registered')) {
				throw error;
			}
		}
		
		// 註冊PostgreSQL版本的認證策略
		server.auth.strategy('bearer_pg', 'bearer-access-token', {
			allowQueryToken: false, // optional, false by default
			validate: async (request, token, h) => {
				// here is where you validate your token
				// comparing with token from your database for example
				const [ targetUid, userToken ] = token.split('.');
				const {
					passcode,
					isAdm,  	// 是否是管理人員
					roles,   	// 身份權限 
				} = await cachedLogin.get(targetUid);


				// isValid 是否驗證成功
				const isValid = userToken === passcode;

				// scope 	-> API 使用權限
				let scope = [ 'base' ];	// 這是最基本的

				// Permit 	-> 頁面的瀏覽權限
				const permit = getPermit(roles);

				// credentials -> 驗證後的憑證
				const credentials = { token, scope };

				// artifacts 使用者所擁有的其他資料 (自由填寫)
				const artifacts = { uid: targetUid, permit: permit };

				return { isValid, credentials, artifacts };
			},
		});


		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/check',
		// 驗證權限，
		// ----------------------------------------------------------------------------------------------------
		
		server.route({
			method: 'Get',
			path: '/pg/auth/check',
			options: {
				description: '登入 - 測試是否成功登入 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api', 'postgres', 'auth'],
				//validate    : { query   : schema, }   // GET
				//validate    : { payload : schema, }   // POST
			},
			handler: async function (request, h) {
				// 權限解析
				const { permit } = request.auth.artifacts;

				return { statusCode: 20000, message: 'successful', data: { roles: permit } };
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// func 密碼驗證
		const comparePass = (password, hash) => {
			const result = bcrypt.compareSync(password, hash);
			return result;
		}

		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/login',
		// 登入系統，
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: ['POST'],
			path: '/auth/login',
			options: {
				description: '[auth]登入 - 透過這個 API 取得 token (PostgreSQL版本)',
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						guild: Joi.number(),
						username: Joi.string().required(),
						password: Joi.string().alphanum().min(4).max(16).required(),
					}),
				},
			},
			handler: async function (request, h) {
				const { guild, username, password } = request.payload;
				const xFF = request.headers['x-forwarded-for'];
				const ip = xFF ? xFF.split(',')[0] : request.info.remoteAddress;

				// step1: 帳號檢查 - 使用PostgreSQL
				const res = await request.pg.client.query(
					`SELECT * FROM users WHERE "UserName" = $1 AND "Active" = 1`,
					[username]
				);
				
				if (res.rowCount === 0) return Boom.unauthorized('Auth Fail! Level1');
				const resUser = res.rows[0];

				// step2: 密碼檢查
				const isPass = await comparePass(password, resUser.PassCode);
				if(!isPass) return Boom.unauthorized('Auth Fail! Level2');

				// step3: 完成登入資料
				const passcode = cryptiles.randomAlphanumString(12);
				const token = resUser.UserId + '.' + passcode;
				
				const permissionRes = await request.pg.client.query(
					`SELECT * FROM users_permission WHERE "UserId" = $1 AND "GuildId" = 0 AND "Value" > 0`,
					[resUser.UserId]
				);

				await cachedLogin.set(
					String(resUser.UserId), //單一登入時這樣存放資料, 准許多重登入就加上 token
					{
						passcode: passcode,  //隨機 12 碼的 token, 
						isAdm: false,
						roles: permissionRes.rows,
					}
				);

				// step4: 寫入 log - 使用PostgreSQL
				await request.pg.client.query(
					`INSERT INTO "users_loginLog" ("UserId", "Ip", "LoginTime") VALUES ($1, $2, NOW())`,
					[resUser.UserId, ip]
				);

				// step5: 寫入 LastLoginTime - 使用PostgreSQL
				await request.pg.client.query(
					`UPDATE users SET "LastLoginTime" = NOW() WHERE "UserId" = $1`,
					[resUser.UserId]
				);

				// step6: 回傳
				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						uid: resUser.UserId,
						token: token
					}
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/loginLog',
		// IP 登入時間
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: 'GET',
			path: '/auth/loginLog',
			options: {
				description: '登入紀錄 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					// query: Joi.object({
					// 	UserId: Joi.number().integer().min(1).required(),
					// }),
				},
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				try {
					const loginLogsRes = await request.pg.client.query(
						'SELECT * FROM "users_loginLog" WHERE "UserId" = $1 ORDER BY "LoginTime" DESC Limit 3',
						[uid]
					);

					return {
						statusCode: 20000,
						data: { loginLogs: loginLogsRes.rows },
					};

				} catch (error) {
					console.error('Error fetching login logs:', error);
					return Boom.internal('An error occurred while fetching login logs');
				}

				
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/usersData',
		// 帳號登入所有資料 (帳號歷程)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/auth/usersData',
			options: {
				description: '帳號歷程 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					query: Joi.object({
						pageCurrent: Joi.number().min(1).default(1).description('現在頁數'),
						pageSize: Joi.number().default(50).description('分頁'),
						userName: Joi.string().allow('').default('').description('使用者名稱'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束日期')
					})
				}
			},
			handler: async function (request, h) {
				const { pageCurrent, pageSize, userName, timeStart, timeEnd } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const sqlCMD = (userName.length != 0) ? ` AND (users1."UserName" = $5 OR users2."UserName" = $5)` : "";
				
				try {
					let query = `
						SELECT 
							users_log.*,
							users1."UserName",
							users2."UserName" AS "FromUserName"
						FROM 
							users_log
							LEFT JOIN users AS users1 ON users_log."UserId" = users1."UserId"
							LEFT JOIN users AS users2 ON users_log."FromUid" = users2."UserId"
						WHERE
							users_log."Create_At" >= $1 AND users_log."Create_At" < $2
						${sqlCMD}
						ORDER BY
							users_log."Create_At" DESC
						LIMIT $3 OFFSET $4`;
					
					let params = [timeStart, timeEnd, String(pageSize), String(offset)];
					if (userName.length != 0) params.push(String(userName));
					
					const usersDataRes = await request.pg.client.query(query, params);

					let countQuery = `
						SELECT 
							COUNT(*) AS total 
						FROM 
							users_log
							LEFT JOIN users AS users1 ON users_log."UserId" = users1."UserId"
							LEFT JOIN users AS users2 ON users_log."FromUid" = users2."UserId"
						WHERE
							users_log."Create_At" >= $1 AND users_log."Create_At" < $2
						${sqlCMD}`;
					
					let countParams = [timeStart, timeEnd];
					if (userName.length != 0) countParams.push(String(userName));
					
					const totalRes = await request.pg.client.query(countQuery, countParams);

					return {
						statusCode: 20000,
						data: { usersData: usersDataRes.rows, total: parseInt(totalRes.rows[0].total) },
					};

				} catch (error) {
					console.log('Error fetching users logs: ', error);
					return Boom.internal('An error occured while fetching users logs');
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/loginData',
		// 全部登入時間資料 (登入歷程)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/auth/loginData',
			options: {
				description: '登入歷程 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					query: Joi.object({
						pageCurrent: Joi.number().min(1).default(1).description('現在頁數'),
						pageSize: Joi.number().default(50).description('分頁'),
						userName: Joi.string().allow('').default('').description('使用者名稱'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束日期')
					})
				},
			},
			handler: async function (request, h) {
				const { pageCurrent, pageSize, userName, timeStart, timeEnd } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const sqlCMD = (userName.length != 0) ? ` AND users1."UserName" = $5` : "";
				
				try {
					let query = `
						SELECT 
							"users_loginLog".*,
							users1."UserName" AS "UserName"
						FROM 
							"users_loginLog"
							LEFT JOIN users AS users1 ON "users_loginLog"."UserId" = users1."UserId"
						WHERE
							"LoginTime" >= $1 AND "LoginTime" < $2
						${sqlCMD}
						ORDER BY
							"users_loginLog"."LoginTime" DESC
						LIMIT $3 OFFSET $4`;
					
					let params = [timeStart, timeEnd, String(pageSize), String(offset)];
					if (userName.length != 0) params.push(String(userName));
					
					const loginDataRes = await request.pg.client.query(query, params);

					let countQuery = `
						SELECT 
							COUNT(*) AS total 
						FROM 
							"users_loginLog" 
							LEFT JOIN users AS users1 ON "users_loginLog"."UserId" = users1."UserId"
						WHERE
							"LoginTime" >= $1 AND "LoginTime" < $2
						${sqlCMD}`;
					
					let countParams = [timeStart, timeEnd];
					if (userName.length != 0) countParams.push(String(userName));
					
					const totalRes = await request.pg.client.query(countQuery, countParams);

					return {
						statusCode: 20000,
						data: { loginData: loginDataRes.rows, total: parseInt(totalRes.rows[0].total) },
					};

				} catch (error) {
					console.error('Error fetching login data: ', error);
					return Boom.internal('An error occurred while fetching login data');
				}

			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		// path: '/auth/logout',
		// 登出系統，
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: 'POST',
			path: '/auth/logout',
			options: {
				description: '登出 - 登出系統 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
			},
			handler: (request, h) => {
				// clear token
				return {
					statusCode: 20000,
					message: 'successful',
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/accountList',
		// 帳號列表
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: 'get',
			path: '/auth/accountList',
			options: {
				description: '帳號列表 (PostgreSQL版本)',
				// auth: { strategy: 'bearer_pg', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					query: Joi.object({
						userName: Joi.string().allow('').default('').description("UserName"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}
			},
			handler: async function (request, h) {
				const { userName, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD = "";
				let params = [];
				
				if (userName.length != 0) {
					sqlCMD = ` WHERE users."UserName" LIKE $1`;
					params.push(`%${userName}%`);
				}

				params.push(String(pageSize), String(offset));
				
				const query = `
					SELECT 
						users."UserId", users."UserName", users."NickName", users."Notes", 
						users."Create_At", users."Update_At", users."Active", users."Create_By", 
						users1."UserName" AS "CreateName"
					FROM 
						users
						LEFT JOIN users AS users1 ON users."Create_By" = users1."UserId"
					${sqlCMD}
					LIMIT $${params.length - 1} OFFSET $${params.length}`;
				
				const res = await request.pg.client.query(query, params);

				const countQuery = `SELECT COUNT(*) AS total FROM users ${sqlCMD}`;
				const countParams = userName.length != 0 ? [`%${userName}%`] : [];
				const totalRes = await request.pg.client.query(countQuery, countParams);

				return { 
					statusCode: 20000, 
					message: 'successful', 
					data: { list: res.rows, total: parseInt(totalRes.rows[0].total) } 
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// func 密碼加密
		const hashPass = (password) => {
			const saltRounds = 12;
			const hash_password = bcrypt.hashSync(password, saltRounds);
			return hash_password;
		}

		// ----------------------------------------------------------------------------------------------------
		// path: '/account',
		// 新增帳號，
		// ----------------------------------------------------------------------------------------------------

		const newAccount = Joi.object({
			account : Joi.string().required().description('帳號'),
			password : Joi.string().required().description('密碼'),
			nickname : Joi.string().required().description('暱稱')
		});

		server.route({
			method: 'POST',
			path: '/auth/account',
			options: {
				description: '帳號 - 新增 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: newAccount,
				},
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { account, password, nickname } = request.payload;
				const hashed = hashPass(password);

				try {
					const res = await request.pg.client.query( 
						`INSERT INTO users ("UserName", "PassCode", "NickName", "Create_By") VALUES ($1, $2, $3, $4)`, 
						[account, hashed, nickname, uid]
					);
				} catch (error) {
					return Boom.notAcceptable(error.message);
				}
				
				return { 
					statusCode: 20000, 
					message: 'successful', 
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/password',
		// 修改密碼
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/auth/password',
			options: {
				description: '密碼 - 修改(自己) (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						oldPwd: Joi.string().required().description('舊密碼'),
						newPwd: Joi.string().required().description('新密碼')
					}) 
				} 
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { oldPwd, newPwd } = request.payload;

				// step1: 帳號檢查
				const userRes = await request.pg.client.query(
					`SELECT * FROM users WHERE "UserId" = $1 AND "Active" = 1`,
					[ uid ]
				);
				if (userRes.rowCount === 0) return Boom.unauthorized('Auth Fail! Level1');
				const resUser = userRes.rows[0];

				// step2: 密碼檢查
				const isPass = comparePass(oldPwd, resUser.PassCode);
				if (!isPass) return Boom.notAcceptable('Auth Fail! Level2');

				// step3: 寫入新密碼
				const hashed = hashPass(newPwd);
				try {
					await request.pg.client.query( 
						`UPDATE users SET "PassCode" = $1, "Update_At" = NOW() WHERE "UserId" = $2`, 
						[hashed, uid]
					);

					// step4: 寫入資料到 users_log
					await request.pg.client.query(
						`INSERT INTO users_log ("UserId", "FromUid", "ActionType", "Create_At") VALUES ($1, $2, 1, NOW())`,
						[resUser.UserId, uid]
					);
					
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.message);
				}
				
				return { 
					statusCode: 20000, 
					message: 'successful', 
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/auth/changePassword',
			options: {
				description: '密碼 - 修改(他人) (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						userId: Joi.number().required().description('UserId'),
						newPwd: Joi.string().required().description('新密碼')
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { userId, newPwd } = request.payload;

				// step1: 帳號檢查
				const userRes = await request.pg.client.query(
					`SELECT * FROM users WHERE "UserId" = $1 AND "Active" = 1`,
					[ userId ]
				);
				if (userRes.rowCount === 0) return Boom.unauthorized('Auth Fail! Level1');
				const resUser = userRes.rows[0];

				// step2: 寫入新密碼
				const hashed = hashPass(newPwd);
				try {
					await request.pg.client.query(
						`UPDATE users SET "PassCode" = $1, "Update_At" = NOW() WHERE "UserId" = $2`,
						[ hashed, userId ]
					);

					// step3: 寫入資料到 users_log
					await request.pg.client.query(
						`INSERT INTO users_log ("UserId", "FromUid", "ActionType", "Create_At") VALUES ($1, $2, 1, NOW())`,
						[resUser.UserId, uid]
					);

				} catch (error) {
					return Boom.notAcceptable(error.message);
				}

				return {
					statusCode: 20000,
					message: 'successful',
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/active',
		// 啟用/停用
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: 'POST',
			path: '/auth/active',
			options: {
				description: '帳號啟用/停用 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						userId: Joi.number().required().description('UserId'),
						isActive: Joi.number().allow(1, 2).required().description('啟用狀態')
					}) }
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { userId, isActive } = request.payload;

				try {
					await request.pg.client.query(
						`UPDATE users SET "Active" = $1, "Update_At" = NOW() WHERE "UserId" = $2`,
						[ isActive, userId ]
					);

					// 寫入狀態到 users_log (31:啟用 / 30:停用)
					const actionType = isActive === 1 ? 31 : 30;
					await request.pg.client.query(
						`INSERT INTO users_log ("UserId", "FromUid", "ActionType", "Create_At") VALUES ($1, $2, $3, NOW())`,
						[userId, uid, actionType]
					);

				} catch (error) {
					return Boom.notAcceptable(error.message);
				}

				return {
					statusCode: 20000,
					message: 'successful',
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/notes',
		// 修改備註
		// ----------------------------------------------------------------------------------------------------

		server.route({
			method: 'POST',
			path: '/auth/notes',
			options: {
				description: '帳號列表 - 修改備註 (PostgreSQL版本)',
				auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						userId: Joi.number().required().description('UserId'),
						notes: Joi.string().allow('').required().description('備註')
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { userId, notes } = request.payload;

				try {
					await request.pg.client.query(
						`UPDATE users SET "Notes" = $1, "Update_At" = NOW() WHERE "UserId" = $2`,
						[ notes, userId ]
					);

					// 修改備註到 users_log
					const objNotes = JSON.stringify({ Notes: notes });
					await request.pg.client.query(
						'INSERT INTO users_log ("UserId", "FromUid", "Notes", "ActionType", "Create_At") VALUES ($1, $2, $3, 2, NOW())',
						[userId, uid, objNotes]
					);

				} catch (error) {
					return Boom.notAcceptable(error.message);
				}

				return {
					statusCode: 20000,
					message: 'successful',
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// path: '/permit',
		// 權限管理
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'get',
			path: '/auth/permit',
			options: {
				description: '使用者權限 (PostgreSQL版本)',
				// auth: { strategy: 'bearer_pg', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					query: Joi.object({
						userId: Joi.number().required().description('UserId')
					})
				}
			},
			handler: async function (request, h) {
				const { userId } = request.query;

				// NOTE: 給定的權限
				let rolesPermit = [];
				Object.keys(permitObj).forEach(authKey => {
					Object.keys(permitObj[authKey]).forEach(subKey => {
						rolesPermit.push(authKey);
						if (subKey != '0') rolesPermit.push(`${authKey}.${subKey}`);
					});
				});

				// 使用者資料
				const userNameRes = await request.pg.client.query(
					`SELECT "UserName" FROM users WHERE "UserId" = $1`,
					[userId]
				);
				
				const UserName = userNameRes.rowCount > 0 ? userNameRes.rows[0].UserName : '';

				const permissionRes = await request.pg.client.query(
					`SELECT * FROM users_permission WHERE "UserId" = $1 AND "GuildId" = 0 AND "Value" > 0`,
					[ userId ]
				);

				const roles = getPermit(permissionRes.rows);
				
				return { 
					statusCode: 20000, 
					message: 'successful', 
					data: { 
						rolesPermit,
						userName: UserName,
						roles
					} 
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/auth/permit',
			options: {
				description: '權限修改 (PostgreSQL版本)',
				// auth: { strategy: 'bearer_pg', scope: ['base'] },
				tags: ['api', 'postgres', 'auth'],
				validate: {
					payload: Joi.object({
						userId: Joi.number().required().description('UserId'),
						roles: Joi.array().items(Joi.string()).min(0).default([]).description('權限')
					})
				}
			},
			handler: async function (request, h) {
				const { userId, roles } = request.payload;

				const permit = roles.reduce((acc, curr) => {
					const [ authKey, subKey ] = curr.split(".");
					if(acc[authKey] == undefined) {
						if (['rAdm', 'beta'].includes(authKey)) acc[authKey] = [ '0' ];
						else if (subKey == undefined) acc[authKey] = [];
						else acc[authKey] = [ subKey ];
					} else acc[authKey].push(subKey);

					return acc
				}, {});

				try {
					// Step1: 先全部disable
					await request.pg.client.query(
						`UPDATE users_permission SET "Value" = 0 WHERE "UserId" = $1`,
						[ userId ]
					);

					// Step2: 設定權限
					for(const authKey of Object.keys(permit)) {
						const value = permit[authKey].reduce((acc, curr) => {
							return acc += permitObj[authKey][curr];
						}, 0);

						const countRes = await request.pg.client.query(
							`SELECT COUNT(*) AS count FROM users_permission WHERE "UserId" = $1 AND "AuthKey" = $2`,
							[ userId, authKey ]
						);

						const count = parseInt(countRes.rows[0].count);
						if (count > 0) {
							await request.pg.client.query(
								`UPDATE users_permission SET "Value" = $1 WHERE "UserId" = $2 AND "AuthKey" = $3`,
								[ value, userId, authKey ]
							);
						} else {
							await request.pg.client.query(
								`INSERT INTO users_permission ("UserId", "AuthKey", "Value") VALUES ($1, $2, $3)`,
								[userId, authKey, value]
							);
						}
					}
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.message);
				}

				return {
					statusCode: 20000,
					message: 'successful',
				};
			},
		});

		console.log('PostgreSQL認證API已註冊');
	},
};
								
