const fs = require('fs').promises;
const path = require('path');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();
const builder = new xml2js.Builder({ cdata: true });

let configName = 'BIM';
let suffixNum = '1';
let date = '202307';
let zone = 0; //行政區
let baseKML; //KML基礎樣板
let networkKML; //主要KML (包含所有切分KML)
const blockLimitSize = 3000; //每個KML的區塊上限
let kmlObj = { block: [], case: [] };

const PCILevelMap = [
  {
    index: 6,
    range: [85, 100],
    description: '很好',
    styleUrl: '#failed1259',
  },
  {
    index: 5,
    range: [70, 85],
    description: '好',
    styleUrl: '#failed3',
  },
  {
    index: 4,
    range: [55, 70],
    description: '尚可',
    styleUrl: '#failed5',
  },
  {
    index: 3,
    range: [40, 55],
    description: '差',
    styleUrl: '#failed59',
  },
  {
    index: 2,
    range: [25, 40],
    description: '很差',
    styleUrl: '#m_ylw-pushpin1',
  },
  {
    index: 1,
    range: [10, 25],
    description: '嚴重',
    styleUrl: '#failed12593',
  },
  {
    index: 0,
    range: [0, 10],
    description: '不合格',
    styleUrl: '#failed1559',
  },
];
const brokeTypeMap = [
  {
    text: '重',
    styleUrl: '#msn_L-blank',
  },
  {
    text: '中',
    styleUrl: '#msn_M-blank',
  },
  {
    text: '輕',
    styleUrl: '#msn_S-blank',
  },
];

async function createKML_PCI(pciJSON, index) {
  let networkKMLClone = JSON.parse(JSON.stringify(networkKML));
  // console.log(networkKMLClone);
  networkKMLClone.kml.Folder[0].NetworkLink = [];

  // 切分block
  const splitPciJSON = pciJSON.reduce(
    (acc, cur) => {
      if (acc[acc.length - 1].length < blockLimitSize)
        acc[acc.length - 1].push(cur);
      else acc.push([cur]);
      return acc;
    },
    [[]]
  );

  for (const [splitId, pciJSONSpec] of splitPciJSON.entries()) {
    console.log(
      `-- (${splitId + 1}/${splitPciJSON.length}) ${pciJSONSpec.length}`
    );

    let baseKMLClone = JSON.parse(JSON.stringify(baseKML));
    baseKMLClone.kml.Document[0].Folder = { Placemark: [] };

    for (const block of pciJSONSpec) {
      // console.log(block);
      let pciInfo = {};
      if (block.PCI_real < 0 || !block.wkb_geometry) continue;
      else if (block.PCI_real >= 100) pciInfo = PCILevelMap[0];
      else
        pciInfo = PCILevelMap.filter(
          (level) =>
            block.PCI_real >= level.range[0] && block.PCI_real < level.range[1]
        )[0];
      const pciValue = Math.round(block.PCI_real * 10) / 10;
      const name = `ID：${block.id}，區塊編號：${block.pciId}，地點：${
        block.roadName
      }，面積：${block.area}㎡，道路編號：${
        String(block.pciId).slice(9, -1) || 0
      }，PCI統計日期：2022/10/01~2022/10/31，PCI程度：${
        pciInfo.description
      }，PCI分數：${pciValue}`;
      const geometry = await parser.parseStringPromise(block.wkb_geometry);
      const geometrySpec = geometry.hasOwnProperty('MultiGeometry')
        ? geometry.MultiGeometry
        : geometry;
      const Placemark = { name, styleUrl: pciInfo.styleUrl, ...geometrySpec };
      // console.log(Placemark);
      baseKMLClone.kml.Document[0].Folder.Placemark.push(Placemark);
    }

    // console.log(baseKMLClone.kml.Document.Folder);
    // if (index == 0) console.log(JSON.stringify(baseKMLClone.kml.Document.Folder));

    const kml = builder.buildObject(baseKMLClone);
    const kmlName = `3_1_${zone}_${
      splitPciJSON.length > 1 ? splitId + 1 : ''
    }P${index}_${suffixNum}.KML`;
    kmlObj.block.push({ name: kmlName, content: kml });

    if (splitPciJSON.length > 1) {
      networkKMLClone.kml.Folder[0].NetworkLink.push({
        name: `BlockSet_${splitId + 1}`,
        Link: {
          href: `https://storage.googleapis.com/map_kml/${configName}/${date}/${kmlName}`,
          refreshMode: 'onInterval',
          refreshInterval: 3600,
        },
      });
    }
  }

  if (splitPciJSON.length > 1) {
    const networkKml = builder.buildObject(networkKMLClone);

    kmlObj.block.push({
      name: `3_1_${zone}_P${index}_${suffixNum}.KML`,
      content: networkKml,
    });
  }
}

async function createKML_case(caseJSON, index) {
  let baseKMLClone = JSON.parse(JSON.stringify(baseKML));
  baseKMLClone.kml.Document[0].Folder = { Placemark: [] };

  for (const caseSpec of caseJSON) {
    // console.log(caseSpec);
    if (caseSpec.PCI_real < 0) continue;

    let description = '';
    if (caseSpec.Place == undefined)
      description = `<table border=1 width="410"><tr><td align="left" colspan="2"><font size=5>PCI_ID：${caseSpec.pciId}</font></td></tr><tr><td align="left" colspan="2"><font size=5>案件ID：${caseSpec.id}</font></td></tr><tr><td align="left" colspan="2"><font size=5>報案種類：${caseSpec.BTName}（${caseSpec.brokeType}度）</font></td></tr><tr><td align="left" colspan="2"><font size=5>地址：${caseSpec.roadName}</font></td></tr><tr><td align="center"><img width=800 height=320 src="https://img.bellsgis.com/images/online_pic/${caseSpec.id}.jpg" class="img" onerror="this.className='img hide-img'"></td></tr></table>`;
    else
      description = `<table border=1 width="410"><tr><td align="left" colspan="2"><font size=3>PCI_ID：${
        caseSpec.pciId
      }</font></td></tr><tr><td align="left" colspan="2"><font size=3>案件ID：${
        caseSpec.id
      }</font></td></tr><tr><td align="left" colspan="2"><font size=3>報案種類：${
        caseSpec.BTName
      }（${
        caseSpec.brokeType
      }度）</font></td></tr><tr><td align="left" colspan="2"><font size=3>地址：${
        caseSpec.Place
      }</font></td></tr><tr><td align="left" colspan="2"><font size=3>面積：${
        Math.round(caseSpec.MillingLength * 100) / 100
      } x ${Math.round(caseSpec.MillingWidth * 100) / 100} = ${
        Math.round(caseSpec.MillingArea * 100) / 100
      }</font></td></tr><tr><td align="center"><img width=800 height=320 src="${
        caseSpec.ImgZoomOut
      }" class="img" onerror="this.className='img hide-img'"></td></tr></table>`;

    const brokeInfo = brokeTypeMap.filter(
      (level) => level.text == caseSpec.brokeType
    )[0];
    const geometry = await parser.parseStringPromise(caseSpec.wkb_geometry);
    const geometrySpec = geometry.hasOwnProperty('MultiGeometry')
      ? geometry.MultiGeometry
      : geometry;
    const Placemark = {
      description,
      styleUrl: brokeInfo.styleUrl,
      ...geometrySpec,
    };
    // console.log(Placemark);
    baseKMLClone.kml.Document[0].Folder.Placemark.push(Placemark);
  }

  // console.log(baseKMLClone.kml.Document.Folder);
  // console.log(JSON.stringify(baseKMLClone));

  const kml = builder.buildObject(baseKMLClone);

  kmlObj.case.push({
    name: `3_1_${zone}_1pointP_${index}_${suffixNum}.KML`,
    content: kml,
  });
}

module.exports = {
  /**
   * @function 產出KML
   * @param {object} pciJSON 區塊JSON
   * @param {object} caseJSON 缺失JSON
   * @param {string} dateStr 日期 (格式: YYYYMM)`
   * @param {number} zoneStr 行政區
   * @returns {object} KML
   */
  genKML: async function (
    pciJSON,
    caseJSON,
    configNameStr,
    dateStr,
    zoneStr,
    suffixNumStr
  ) {
    kmlObj = { block: [], case: [] };

    if (configNameStr != undefined && configNameStr.length != 0)
      configName = configNameStr;
    if (dateStr != undefined && dateStr.length != 0) date = dateStr;
    if (zoneStr != undefined) zone = Number(zoneStr);
    if (suffixNum != undefined) suffixNum = Number(suffixNumStr);

    baseKML = await parser.parseStringPromise(
      await fs.readFile(path.join(__dirname, './template/google.kml'), 'utf-8')
    );
    networkKML = await parser.parseStringPromise(
      await fs.readFile(
        path.join(__dirname, './template/networkLink.kml'),
        'utf-8'
      )
    );

    let levelObj = { 6: { block: [], case: [] } };

    for (const level of PCILevelMap) {
      if (!levelObj.hasOwnProperty(level.index))
        levelObj[level.index] = { block: [], case: [] };

      for (const [type, JSONSpec] of [
        ['block', pciJSON],
        ['case', caseJSON],
      ]) {
        for (const item of JSONSpec) {
          const condition =
            (level.index == 6 && item.PCI_real == 100) ||
            (item.PCI_real >= level.range[0] && item.PCI_real < level.range[1]);
          if (item.PCI_real < 0) continue;
          else if (condition) levelObj[level.index][type].push(item);
        }
      }
    }
    // console.log(levelObj);

    for (const index in levelObj) {
      const JSONSpec = levelObj[index];
      console.log(index, JSONSpec.block.length, JSONSpec.case.length);
      if (JSONSpec.block.length != 0)
        await createKML_PCI(JSONSpec.block, index, suffixNum);
      if (JSONSpec.case.length != 0) await createKML_case(JSONSpec.case, index);
    }

    return kmlObj;
  },
};
