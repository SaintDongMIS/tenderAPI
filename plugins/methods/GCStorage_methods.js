'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { Storage } = require('@google-cloud/storage');
const stream = require('stream');

let bucketName = 'adm_distress_image';

// const storage = new Storage();
const GCloudKey = JSON.parse(process.env.GCLOUD_KEY);
const storage = new Storage({
	credentials: {
		private_key: GCloudKey.PRIVATE_KEY,
		client_email: GCloudKey.CLIENT_EMAIL
	}
});

let GCBucket = storage.bucket(bucketName);

const authStrategy = false;
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'GCStorage_methods',
	version: '0.0.0',
	register: async function (server, options) {

		// set bucket
		const setBucket = async function (bucketNameSet) {
			GCBucket = storage.bucket(bucketNameSet);
			bucketName = bucketNameSet;
		}

		// Get file list
		const getFileList = async function (destFileName) {
			return new Promise((resolve, reject) => {
				GCBucket.getFiles({ prefix: destFileName }).then(data => { 
					// console.log(data[0].map(file => file.name));
					resolve(data[0].map(file => file.name));
				});
			})
		}

		// Memory
		const uploadFile = async function (data, destFileName) {
			const fileUpload = GCBucket.file(destFileName);

			return new Promise((resolve, reject)  => {
				fileUpload.exists().then(([ isExist ]) => {
					if (!isExist) {
						fileUpload.save(data, { resumable: false }).then(async () => {
							console.log(`${destFileName} uploaded to ${bucketName}`);
							resolve(await fileUpload.publicUrl());
						}).catch((err) => {
							console.log(err);
							reject(err.errors[0]);
						});
					} else reject("File already exist!");
				})
			})
		}

		// Stream
		const uploadStreamFile = async function (data, destFileName) {
			const fileUpload = GCBucket.file(destFileName);

			return new Promise((resolve, reject) => {
				fileUpload.exists().then(([ isExist ]) => {
					if(!isExist) {
						const passthroughStream = new stream.PassThrough();
						passthroughStream.write(data);
						passthroughStream.end();

						passthroughStream.pipe(fileUpload.createWriteStream({ resumable: false }))
							.on('error', (err) => reject(err.errors[0]))
							.on('finish', async () => {
								console.log(`${destFileName} uploaded to ${bucketName}`);
								resolve(await fileUpload.publicUrl());
							});
					} else reject("File already exist!");
				});
			})
		}

		// URL
		const uploadFileUrl = async function (url, destFileName) {
			const fileUpload = GCBucket.file(destFileName);

			return new Promise((resolve, reject) => {
				fileUpload.exists().then( async ([ isExist ]) => {
					if (!isExist) {
						const req = request(url)
						req.pause();
						req.on("response", res => {
							if (res.statusCode !== 200) {
								return reject(
									new Error(`Failed to request file from url: ${url}, status code: ${res.statusCode}`)
								);
							}

							req.pipe(
								fileUpload.createWriteStream({
									resumable: false,
									public: true,
									metadata: { contentType: res.headers["content-type"] }
								})
							).on("error", err => {
								reject(
									new Error(`Failed to upload ${url} to ${destFileName}: ${err.message}`)
								);
							}).on("finish", async() => {
								console.log(`Successfully uploaded ${url} to ${destFileName}`);
								resolve(await fileUpload.publicUrl());
							});
							req.resume();
						})
					} else resolve(await fileUpload.publicUrl());
				})
			})
		}

		// register method
		server.method('setBucket', setBucket);						// 設定值區
		server.method('getFileList', getFileList);						// 取得檔案列表
		server.method('uploadFile', uploadFile);							// 上傳檔案
		server.method('uploadStreamFile', uploadStreamFile);	// 上傳檔案(Stream)
		server.method('uploadFileUrl', uploadFileUrl); // 上傳檔案(Url)
		/* Router End */
	},
};
