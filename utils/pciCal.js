module.exports = {
	/**
	 * @function 計算折減值
	 * @param {string} dType 缺失類別
	 * @param {string} dLevel 損壞程度: 3(重)、2(中)、1(輕)
	 * @param {number} density 密度
	 * @returns {number} 折減值
	*/
	calDV(dType, dLevel, density) {
		// Step1: 計算折減值(DV)
		const levelMap = { 1: "L", 2: "M", 3: "H"};
		return module.exports.DV_formula[`func${String(dType).padStart(2, '0')}${levelMap[dLevel]}`](density);
	},
	/**
	 * @function 計算PCI
	 * @param {number[]} DVArr 折減值陣列
	 * @returns {number} PCI
	*/
	calPCI(DVArr) {
		// Step2: 計算最大容許折減個數(m)
		DVArr.sort((a, b) => (b - a));
		// console.log(DVArr);
		const m = Math.ceil(1 + (9 / 98) * (100 - DVArr[0]));
		const limit = m >= 7 ? 7 : m;
		// console.log(m, limit);
		DVArr = DVArr.slice(0, limit);
		// console.log("DVArr: ", DVArr);

		// Step3: 計算修正折減值(CDV)
		const q = DVArr.filter(DV => DV >= 2).length || 1;
		let cdvList = [];
		const dvListArr = [];
		const tdvArr = [];
		const cdvDetails = [];

		for(let i=1; i<=q; i++) {
			// console.log("i: ", i);
			let dvList = JSON.parse(JSON.stringify(DVArr));
			dvList.splice(i, q-i, ...Array.from({length: q-i}, () => (2)));
			// console.log("dVList: ", dvList);
			const tdv = dvList.reduce((acc, cur) => (acc+cur), 0);
			// console.log("tdv: ", tdv);
			const cdv = module.exports.CDV_formula[`funcQ${i}`](tdv);
			// console.log(`cdv(funcQ${i}): `, cdv);
			cdvList.push(cdv);

			dvListArr.push(dvList);
			tdvArr.push(tdv);
			cdvDetails.push(cdv);
		}

		// Step4: 計算PCI
		cdvList.sort((a, b) => (b - a));
		// console.log("cdvList: ", cdvList);
		const PCI = 100 - cdvList[0];

		return {
			PCI,
			dvListArr,
			tdvArr,
			cdvDetails
		}
	},

	/** 
	 * 折減值計算公式
	 * ---
	 * @function func{dType}}{dLevel}
	 * @param {string} dType 缺失類別
	 * @param {string} dLevel 損壞程度: H(重)、M(中)、L(輕)
	 * 
	 * dType(缺失類別):
	 * 1.龜裂; 2.縱橫裂縫; 3.塊狀裂縫; 4.坑洞、人孔高差及薄層剝離; 5.車轍;
	 * 6.補綻及管線回填; 7.推擠; 8.隆起與凹陷; 9.冒油; 10.波浪狀鋪面;
	 * 11.車道與路肩分離; 12.滑溜裂縫; 13.骨材剝落;
	 * ---
	 * 21.凹陷; 22.邊緣裂縫; 23.反射裂縫; 24.跨越鐵道; 25.隆起; 26.剝脫; 27.老化;
	*/
	DV_formula: {
		//-----------------------------------------------
		// dType01: 龜裂
		//-----------------------------------------------
		/**
		 * @function 龜裂(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func01H(density) {
			return (1.1698 * Math.pow(Math.log10(density), 4))
				- (5.1715 * Math.pow(Math.log10(density), 3))
				+ (5.6549 * Math.pow(Math.log10(density), 2))
				+ (30.411 * Math.log10(density))
				+ 30.735
		},
		/**
		 * @function 龜裂(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func01M(density) {
			return -0.7357 * Math.pow(Math.log10(density), 3)
				+ (5.3424 * Math.pow(Math.log10(density), 2))
				+ (20.62 * Math.log10(density))
				+ 21.582
		},
		/**
		 * @function 龜裂(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func01L(density) {
			return -1.6739 * Math.pow(Math.log10(density), 3)
				+ (7.7918 * Math.pow(Math.log10(density), 2))
				+ (16.423 * Math.log10(density))
				+ 11.028
		},

		//-----------------------------------------------
		// dType02: 縱橫裂縫
		//-----------------------------------------------
		/**
		 * @function 縱橫裂縫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func02H(density) {
			return -6.2208 * Math.pow(Math.log10(density), 4)
				+ 17.791 * Math.pow(Math.log10(density), 3)
				+ 3.1165 * Math.pow(Math.log10(density), 2)
				+ (11.026 * Math.log10(density))
				+ 8.6518
		},
		/**
		 * @function 縱橫裂縫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func02M(density) {
			return -2.02 * Math.pow(Math.log10(density), 3)
				+ 10.809 * Math.pow(Math.log10(density), 2)
				+ (7.4669 * Math.log10(density))
				+ 2.1769
		},
		/**
		 * @function 縱橫裂縫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func02L(density) {
			return 1.5299 * Math.pow(Math.log10(density), 3)
				+ 0.6046 * Math.pow(Math.log10(density), 2)
				+ (7.8026 * Math.log10(density))
				- 1.997
		},

		//-----------------------------------------------
		// dType03: 塊狀裂縫
		//-----------------------------------------------
		/**
		 * @function 塊狀裂縫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func03H(density) {
			return 7.1
				+ (15.26 * (Math.log10(density)))
				+ (8.65 * Math.pow(Math.log10(density), 2))
		},
		/**
		 * @function 塊狀裂縫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func03M(density) {
			return 2.2
				+ (8.98 * (Math.log10(density)))
				+ (5.67 * (Math.pow(Math.log10(density), 2)))
		},
		/**
		 * @function 塊狀裂縫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func03L(density) {
			return (9.19 * Math.log10(density))
				- (3.9 * Math.pow(Math.log10(density), 2))
				+ (3.16 * Math.pow(Math.log10(density), 3))
		},
		
		//-----------------------------------------------
		// dType04: 坑洞、人孔高差及薄層剝離
		//-----------------------------------------------
		/**
		 * @function 坑洞、人孔高差及薄層剝離(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func04H(density) {
			return 3.0149 * Math.pow(Math.log10(density), 4)
				- 3.1937 * Math.pow(Math.log10(density), 3)
				+ 7.5699 * Math.pow(Math.log10(density), 2)
				+ 46.362 * Math.log10(density)
				+ 52.447
		},
		/**
		 * @function 坑洞、人孔高差及薄層剝離(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func04M(density) {
			return -1.2843 * Math.pow(Math.log10(density), 4)
				- 0.1844 * Math.pow(Math.log10(density), 3)
				+ 16.201 * Math.pow(Math.log10(density), 2)
				+ 40.919 * Math.log10(density)
				+ 31.228
		},
		/**
		 * @function 坑洞、人孔高差及薄層剝離(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func04L(density) {
			return 0.8916 * Math.pow(Math.log10(density), 5)
				- 1.8541 * Math.pow(Math.log10(density), 4)
				- 2.9475 * Math.pow(Math.log10(density), 3)
				+ 11.455 * Math.pow(Math.log10(density), 2)
				+ 28.534 * Math.log10(density)
				+ 19.303
		},

		//-----------------------------------------------
		// dType05: 車轍
		//-----------------------------------------------
		/**
		 * @function 車轍(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func05H(density) {
			return 27.1
				+ 30.36 * Math.log10(density)
				+ 7.48 * Math.pow(Math.log10(density), 2)
				- 3.34 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 車轍(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func05M(density) {
			return 18.2
				+ 22.51 * Math.log10(density)
				+ 6.72 * Math.pow(Math.log10(density), 2)
				- 2.75 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 車轍(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func05L(density) {
			return 7.6
				+ 15.42 * Math.log10(density)
				+ 7.6 * Math.pow(Math.log10(density), 2)
				- 2.29 * Math.pow(Math.log10(density), 3)
		},

		//-----------------------------------------------
		// dType06: 補綻及管線回填
		//-----------------------------------------------
		/**
		 * @function 補綻及管線回填(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func06H(density) {
			return -10.621 * Math.pow(Math.log10(density), 4)
				+ 20.923 * Math.pow(Math.log10(density), 3)
				+ 8.0635 * Math.pow(Math.log10(density), 2)
				+ 13.894 * Math.log10(density)
				+ 19.618
		},
		/**
		 * @function 補綻及管線回填(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func06M(density) {
			return 0.853 * Math.pow(Math.log10(density), 3)
				+ 7.8518 * Math.pow(Math.log10(density), 2)
				+ 12.666 * Math.log10(density)
				+ 9.7334
		},
		/**
		 * @function 補綻及管線回填(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func06L(density) {
			return 1.0169 * Math.pow(Math.log10(density), 3)
				+ 4.865 * Math.pow(Math.log10(density), 2)
				+ 6.9841 * Math.log10(density)
				+ 2.8831
		},

		//-----------------------------------------------
		// dType07: 推擠
		//-----------------------------------------------
		/**
		 * @function 推擠(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func07H(density) {
			return 18.8
				+ 23.88 * Math.log10(density)
				+ 11.25 * Math.pow(Math.log10(density), 2)
				- 2.2 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 推擠(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func07M(density) {
			return 9.4
				+ 16.12 * Math.log10(density)
				+ 9.95 * Math.pow(Math.log10(density), 2)
		},
		/**
		 * @function 推擠(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func07L(density) {
			return 4
				+ 12.06 * Math.log10(density)
				+ 4.21 * Math.pow(Math.log10(density), 2)
		},

		//-----------------------------------------------
		// dType08: 隆起與凹陷
		//-----------------------------------------------
		/**
		 * @function 隆起與凹陷(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func08H(density) {
			return 34.053
				+ (30.519 * Math.log10(density))
				+ (8.0564 * Math.pow(Math.log10(density), 2))
		},
		/**
		 * @function 隆起與凹陷(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func08M(density) {
			return (9.7507 * Math.pow(Math.log10(density), 3))
				+ (3.2471 * Math.pow(Math.log10(density), 2))
				+ (15.617 * Math.log10(density))
				+ 12.724
		},
		/**
		 * @function 隆起與凹陷(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func08L(density) {
			return (8.6997 * Math.pow(Math.log10(density), 3))
				- (0.8374 * Math.pow(Math.log10(density), 2))
				+ (5.6832 * Math.log10(density))
				+ 3.7406
		},

		//-----------------------------------------------
		// dType09: 冒油
		//-----------------------------------------------
		/**
		 * @function 冒油(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func09H(density) {
			return 6.2
				+ (7.87 * Math.log10(density))
				+ (6.79 * Math.pow(Math.log10(density), 2))
				+ (3.06 * Math.pow(Math.log10(density), 3))
		},
		/**
		 * @function 冒油(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func09M(density) {
			return 3.2
				+ (4.33 * Math.log10(density))
				+ (3.02 * Math.pow(Math.log10(density), 2))
				+ (1.99 * Math.pow(Math.log10(density), 3))
		},
		/**
		 * @function 冒油(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func09L(density) {
			return (1.23 * Math.log10(density))
				- (0.16 * Math.pow(Math.log10(density), 2))
				+ (2.28 * Math.pow(Math.log10(density), 3))
		},

		//-----------------------------------------------
		// dType10: 波浪狀鋪面
		//-----------------------------------------------
		/**
		 * @function 波浪狀鋪面(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func10H(density) {
			return 33.6
				+ (25.19 * Math.log10(density))
				+ (2.62 * Math.pow(Math.log10(density), 2))
		},
		/**
		 * @function 波浪狀鋪面(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func10M(density) {
			return 15
				+ (17.16 * Math.log10(density))
				+ (6.25 * Math.pow(Math.log10(density), 2))
		},
		/**
		 * @function 波浪狀鋪面(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func10L(density) {
			return 2
				+ (4.76 * Math.log10(density))
				+ (4.95 * Math.pow(Math.log10(density), 2))
				+ Math.pow(Math.log10(density), 3)
		},

		//-----------------------------------------------
		// dType11: 車道與路肩分離
		//-----------------------------------------------
		/**
		 * @function 車道與路肩分離(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func11H(density) {
			return 7.9
				- (12.86 * Math.log10(density))
				+ 19.84 * Math.pow(Math.log10(density), 2)
		},
		/**
		 * @function 車道與路肩分離(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func11M(density) {
			return 2.5
				+ (11.18 * Math.log10(density))
				- 16.41 * Math.pow(Math.log10(density), 2)
				+ 10.79 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 車道與路肩分離(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func11L(density) {
			return 2.6
				- (4.38 * Math.log10(density))
				+ 6.85 * Math.pow(Math.log10(density), 2)
		},

		//-----------------------------------------------
		// dType12: 滑溜裂縫
		//-----------------------------------------------
		/**
		 * @function 滑溜裂縫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func12H(density) {
			return 20.5
				+ 37.5 * Math.log10(density)
				+ 14.78 * Math.pow(Math.log10(density), 2)
				- 8.09 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 滑溜裂縫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func12M(density) {
			return 11.6
				+ 23.63 * Math.log10(density)
				+ 11.29 * Math.pow(Math.log10(density), 2)
				- 4.24 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 滑溜裂縫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func12L(density) {
			return 5.3
				+ 14.51 * Math.log10(density)
				+ 8.09 * Math.pow(Math.log10(density), 2)
				- 1.54 * Math.pow(Math.log10(density), 3)
		},

		//-----------------------------------------------
		// dType13: 骨材剝落
		//-----------------------------------------------
		/**
		 * @function 骨材剝落(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func13H(density) {
			return -14.8
				+ 39.71 * Math.log10(density)
				- 30.89 * Math.pow(Math.log10(density), 2)
				+ 9.89 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 骨材剝落(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func13M(density) {
			return -14.8
				+ 39.71 * Math.log10(density)
				- 30.89 * Math.pow(Math.log10(density), 2)
				+ 9.89 * Math.pow(Math.log10(density), 3)
		},
		/**
		 * @function 骨材剝落(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func13L(density) {
			return -14.8
				+ 39.71 * Math.log10(density)
				- 30.89 * Math.pow(Math.log10(density), 2)
				+ 9.89 * Math.pow(Math.log10(density), 3)
		},

		//-----------------------------------------------
		// dType21: 凹陷
		//-----------------------------------------------
		/**
		 * @function 凹陷(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func21H(density) {
			return (2.8703 * Math.pow(Math.log10(density), 6))
				- (9.445 * Math.pow(Math.log10(density), 5))
				- (1.5438 * Math.pow(Math.log10(density), 4))
				+ (18.966 * Math.pow(Math.log10(density), 3))
				+ (9.0434 * Math.pow(Math.log10(density), 2))
				+ (6.01 * Math.log10(density))
				+ 17.256
		},
		/**
		 * @function 凹陷(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func21M(density) {
			return 1.6567 * Math.pow(Math.log10(density), 6)
				- 6.3705 * Math.pow(Math.log10(density), 5)
				- 0.8291 * Math.pow(Math.log10(density), 4)
				+ 15.152 * Math.pow(Math.log10(density), 3)
				+ 9.4284 * Math.pow(Math.log10(density), 2)
				+ (1.6245 * Math.log10(density))
				+ 8.7465
		},
		/**
		 * @function 凹陷(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func21L(density) {
			return 1.4041 * Math.pow(Math.log10(density), 6)
				- 5.908 * Math.pow(Math.log10(density), 5)
				+ 1.1745 * Math.pow(Math.log10(density), 4)
				+ 13.451 * Math.pow(Math.log10(density), 3)
				+ 4.3519 * Math.pow(Math.log10(density), 2)
				- (0.7013 * Math.log10(density))
				+ 4.5359
		},

		//-----------------------------------------------
		// dType22: 邊緣裂縫
		//-----------------------------------------------
		/**
		 * @function 邊緣裂縫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func22H(density) {
			return 8.0582 * Math.pow(Math.log10(density), 6)
				- 33.091 * Math.pow(Math.log10(density), 5)
				+ 35.479 * Math.pow(Math.log10(density), 4)
				+ 3.4193 * Math.pow(Math.log10(density), 3)
				- 4.1401 * Math.pow(Math.log10(density), 2)
				+ (4.8435 * Math.log10(density))
				+ 9.5791
		},
		/**
		 * @function 邊緣裂縫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func22M(density) {
			return 4.2323 * Math.pow(Math.log10(density), 6)
				- 15.351 * Math.pow(Math.log10(density), 5)
				+ 12.667 * Math.pow(Math.log10(density), 4)
				+ 6.5276 * Math.pow(Math.log10(density), 3)
				- 2.2873 * Math.pow(Math.log10(density), 2)
				+ (2.6352 * Math.log10(density))
				+ 6.3127
		},
		/**
		 * @function 邊緣裂縫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func22L(density) {
			return 1.9842 * Math.pow(Math.log10(density), 6)
				- 7.0969 * Math.pow(Math.log10(density), 5)
				+ 6.6494 * Math.pow(Math.log10(density), 4)
				+ 2.0261 * Math.pow(Math.log10(density), 3)
				- 2.0166 * Math.pow(Math.log10(density), 2)
				+ (2.8793 * Math.log10(density))
				+ 1.825
		},

		//-----------------------------------------------
		// dType23: 反射裂縫
		//-----------------------------------------------
		/**
		 * @function 反射裂縫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func23H(density) {
			return 7.649 * Math.pow(Math.log10(density), 6)
				- 39.473 * Math.pow(Math.log10(density), 5)
				+ 56.548 * Math.pow(Math.log10(density), 4)
				- 8.8871 * Math.pow(Math.log10(density), 3)
				- 5.7075 * Math.pow(Math.log10(density), 2)
				+ (13.979 * Math.log10(density))
				+ 7.7093
		},
		/**
		 * @function 反射裂縫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func23M(density) {
			return 1.6593 * Math.pow(Math.log10(density), 6)
				- 11.165 * Math.pow(Math.log10(density), 5)
				+ 19.712 * Math.pow(Math.log10(density), 4)
				- 5.3614 * Math.pow(Math.log10(density), 3)
				+ 0.7682 * Math.pow(Math.log10(density), 2)
				+ (7.8795 * Math.log10(density))
				+ 2.7104
		},
		/**
		 * @function 反射裂縫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func23L(density) {
			return 0.2494 * Math.pow(Math.log10(density), 6)
				- 10.15 * Math.pow(Math.log10(density), 5)
				+ 50.091 * Math.pow(Math.log10(density), 4)
				- 92.426 * Math.pow(Math.log10(density), 3)
				+ 78.259 * Math.pow(Math.log10(density), 2)
				- (21.364 * Math.log10(density))
				+ 1.9869
		},
		
		//-----------------------------------------------
		// dType24: 跨越鐵道
		//-----------------------------------------------
		/**
		 * @function 跨越鐵道(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func24H(density) {
			return -12.481 * Math.pow(Math.log10(density), 6)
				+ 104.06 * Math.pow(Math.log10(density), 5)
				- 279.92 * Math.pow(Math.log10(density), 4)
				+ 292.51 * Math.pow(Math.log10(density), 3)
				- 99.122 * Math.pow(Math.log10(density), 2)
				+ 42.827 * Math.log10(density)
				+ 19.979
		},
		/**
		 * @function 跨越鐵道(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func24M(density) {
			return 14.496 * Math.pow(Math.log10(density), 5)
				- 50.849 * Math.pow(Math.log10(density), 4)
				+ 37.83 * Math.pow(Math.log10(density), 3)
				+ 20.568 * Math.pow(Math.log10(density), 2)
				+ 10.243 * Math.log10(density)
				+ 6.5593
		},
		/**
		 * @function 跨越鐵道(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func24L(density) {
			return 4.8925 * Math.pow(Math.log10(density), 5)
				- 25.401 * Math.pow(Math.log10(density), 4)
				+ 37.896 * Math.pow(Math.log10(density), 3)
				- 10.748 * Math.pow(Math.log10(density), 2)
				+ 3.3034 * Math.log10(density)
				+ 2.0165
		},
		
		//-----------------------------------------------
		// dType25: 隆起
		//-----------------------------------------------
		/**
		 * @function 隆起(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func25H(density) {
			return 13.906 * Math.pow(Math.log10(density), 6)
				+ 61.837 * Math.pow(Math.log10(density), 5)
				- 105.69 * Math.pow(Math.log10(density), 4)
				+ 85.238 * Math.pow(Math.log10(density), 3)
				- 19.729 * Math.pow(Math.log10(density), 2)
				+ 12.251 * Math.log10(density)
				+ 34
		},
		/**
		 * @function 隆起(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func25M(density) {
			return 41.641 * Math.pow(Math.log10(density), 6)
				+ 177.68 * Math.pow(Math.log10(density), 5)
				- 281 * Math.pow(Math.log10(density), 4)
				+ 202.48 * Math.pow(Math.log10(density), 3)
				- 60.676 * Math.pow(Math.log10(density), 2)
				+ 26.157 * Math.log10(density)
				+ 12
		},
		/**
		 * @function 隆起(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func25L(density) {
			return 2.2004 * Math.pow(Math.log10(density), 4)
				- 6.2736 * Math.pow(Math.log10(density), 3)
				+ 9.4633 * Math.pow(Math.log10(density), 2)
				+ 4.869 * Math.log10(density)
				+ 1.9733
		},

		//-----------------------------------------------
		// dType26: 剝脫
		//-----------------------------------------------
		/**
		 * @function 剝脫(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func26H(density) {
			return 0.6765 * Math.pow(Math.log10(density), 5)
				- 1.569 * Math.pow(Math.log10(density), 4)
				+ 5.4549 * Math.pow(Math.log10(density), 3)
				+ 9.7862 * Math.pow(Math.log10(density), 2)
				+ 12.573 * Math.log10(density)
				+ 16.097
		},
		/**
		 * @function 剝脫(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func26M(density) {
			return 0.3323 * Math.pow(Math.log10(density), 5)
				- 0.3137 * Math.pow(Math.log10(density), 4)
				+ 3.8354 * Math.pow(Math.log10(density), 3)
				+ 3.1102 * Math.pow(Math.log10(density), 2)
				+ 3.4121 * Math.log10(density)
				+ 8.6008
		},
		/**
		 * @function 剝脫(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func26L(density) {
			return 0;
		},

		//-----------------------------------------------
		// dType27: 老化
		//-----------------------------------------------
		/**
		 * @function 老化(重)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func27H(density) {
			return 0.8865 * Math.pow(Math.log10(density), 6)
				+ 0.947 * Math.pow(Math.log10(density), 5)
				+ 1.9921 * Math.pow(Math.log10(density), 4)
				+ 1.5996 * Math.pow(Math.log10(density), 3)
				+ 3.209 * Math.pow(Math.log10(density), 2)
				+ 2.0614 * Math.log10(density)
				+ 2.7839
		},
		/**
		 * @function 老化(中)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func27M(density) {
			return 0.0512 * Math.pow(Math.log10(density), 6)
				- 0.1878 * Math.pow(Math.log10(density), 5)
				+ 0.4454 * Math.pow(Math.log10(density), 4)
				+ 1.3193 * Math.pow(Math.log10(density), 3)
				+ 1.145 * Math.pow(Math.log10(density), 2)
				+ 0.4697 * Math.log10(density)
				+ 1.0694
		},
		/**
		 * @function 老化(輕)
		 * @param {number} density 密度
		 * @returns {number} 折減值
		*/
		func27L(density) {
			return 0.4909 * Math.pow(Math.log10(density), 5)
				+ 0.8143 * Math.pow(Math.log10(density), 4)
				+ 1.1776 * Math.pow(Math.log10(density), 3)
				- 0.3889 * Math.pow(Math.log10(density), 2)
				- 0.2948 * Math.log10(density)
				+ 0.5071
		}
	},

	/**
	 * 修正折減值計算公式
	 * ---
	 * @function funcQ{num}: １~７
	 * @param {number} num 個數
	*/
	CDV_formula: {
		/**
		 * @function 數量1
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ1(tdv) {
			return tdv;
		},
		/**
		 * @function 數量2
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ2(tdv) {
			return -3.6 + 0.91 * tdv - 0.0017 * Math.pow(tdv, 2);
		},
		/**
		 * @function 數量3
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ3(tdv) {
			return -6.4 + 0.82 * tdv - 0.0013 * Math.pow(tdv, 2);
		},
		/**
		 * @function 數量4
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ4(tdv) {
			return -13 + 0.86 * tdv - 0.0015 * Math.pow(tdv, 2);
		},
		/**
		 * @function 數量5
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ5(tdv) {
			return -12 + 0.76 * tdv - 0.0011 * Math.pow(tdv, 2);
		},
		/**
		 * @function 數量6
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ6(tdv) {
			return -14.7 + 0.75 * tdv - 0.0011 * Math.pow(tdv, 2);
		},
		/**
		 * @function 數量7
		 * @param {number} tdv 總折減值
		 * @returns {number} 修正折減值
		*/
		funcQ7(tdv) {
			return -18.5 + 0.86 * tdv - 0.0018 * Math.pow(tdv, 2);
		}
	}
}