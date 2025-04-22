專案需求
====================
```
node: 16+
npm: 9.6.0+
```

專案安裝及啟動
====================
```
# for npm
npm install 
npm start 
# for yarn
yarn install
yarn start
```

設定參數
====================

|參數名稱         | 備註                |
|---------------|---------------------|
|DATABASE_URL   | postgreSQL 的 URL   |
|UPLOAD_PATH    | 缺失照片及軌跡上傳路徑  |


專案正式環境檔案結構
====================
35.187.159.100:/home/yulizi

├── api2_keeplive.sh          # 讓 api 保持運作 (排程用)
├── api2_restart.sh           # 重新啟動 api   (排程用)
├── api2_start.sh             # 啟動 api                   
├── case                      # 缺失照片資料夾
│   ├── rms1                  # 一標
│   ├── rms2                  # 二標 
│   ├── rms3                  # 三標
│   ├── rms4                  # 四標
│   └── rms5                  # 五標
├── del_dev_files.sh          # 刪除開發環境檔案 (排程用)
├── del_files.sh              # 刪除正式環境檔案 (排程用)
├── gps                       # 巡查軌跡資料夾
│   ├── car1_1                # 一標一車
│   ├── car1_2                # 一標二車
│   ├── car1_3                # 一標三車
│   ├── car2_1                # 二標一車
│   ├── car2_2                # 二標二車
│   ├── car2_3                # 二標三車
│   ├── car3_1                # 三標一車
│   ├── car3_2                # 三標二車
│   ├── car3_3                # 三標三車
│   ├── car4_1                # 四標一車
│   ├── car4_2                # 四標二車
│   ├── car4_3                # 四標三車
│   ├── car5_1                # 五標一車
│   ├── car5_2                # 五標二車
│   └── car5_3                # 五標三車
├── handle_photo.sh           # 傳輸一標缺失照片至 rm 伺服器 (排程用)
├── handle_photo_2.sh         # 傳輸二標缺失照片至 rm 伺服器 (排程用)
├── handle_photo_4.sh         # 傳輸四標缺失照片至 rm 伺服器 (排程用)
├── handle_photo_5.sh         # 傳輸五標缺失照片至 rm 伺服器 (排程用)
├── mv_gps_to_road_server.sh  # 傳輸所有標巡查軌跡至 rm 伺服器 (排程用)
└── tenderAPI2                # api 專案所在位置
```
/tmp/api${yyyy}_${MM}_${dd}_${HH}_${mm}_${ss}.txt          # api log, 重開機會被清除
```

RabbitMQ & Darknet Yolo 正式環境
====================
192.168.88.5:/home/yulizi

├── detect.sh                 # 啟動 RabbitMQ 及 Yolo 辨識服務 (排程用)
├── move_ai_case_images.sh    # 移動辨識後的缺失照片至 RM 伺服器 (排程用)
├── roadCrackModelDetect      # Yolo 辨識服務
│   ├── defect_analysis_image_tw_nowday_r1.py  # 辨識主程式
│   ├── input                 # 辨識前照片
│   │   ├── rms1              # 一標照片資料夾
│   │   ├── rms2              # 二標照片資料夾
│   │   ├── rms3              # 三標照片資料夾
│   │   ├── rms4              # 四標照片資料夾
│   │   └── rms5              # 五標照片資料夾
│   ├── logging.txt           # 日誌檔
│   ├── models                # 辨識用模型 (非常大, 不在 git 中)
│   ├── output                # 辨識後照片
│   │   ├── rms1              # 一標照片資料夾
│   │   ├── rms2              # 二標照片資料夾
│   │   ├── rms3              # 三標照片資料夾
│   │   ├── rms4              # 四標照片資料夾
│   │   └── rms5              # 五標照片資料夾
│   ├── requirements.txt      # python 套件管理檔案
│   ├── run.sh                # 執行辨識服務
│   └── wt009.ttf             # 辨識後照片標示所需的字型檔
├── RoadCrackRabbitConsumer   # RabbitMQ 服務
│   ├── check_env.py          # 檢查環境變數 (可在 .bashrc 查看)
│   ├── configs               # 設定檔資料夾
│   │   ├── bim.json          # 預設設定
│   │   └── ttl.json          # 其他設定
│   ├── consume.py            # 寫入檔案
│   ├── key.txt               # 環境變數解密key
│   ├── kill_consuming.py     # 內容空白
│   ├── logs                  # 日誌
│   │   ├── detection.log     # 預設日誌
│   │   └── streaming.log     # 未使用
│   ├── print_env.py          # 印出環境變數
│   ├── README.md             # 說明文件 (可不看)
│   ├── requirements.txt      # python 套件管理檔案
│   ├── run.sh                # 執行 RabbitMQ 服務
│   ├── start_consuming.py    # RabbitMQ 主程式
│   ├── temp                  # 暫時資料夾
│   │   └── pids.txt          # 搭配 kill_consuming.py
│   ├── test_data             # 測試資料
│   └── upload.py             # 上傳


RabbitMQ & Darknet Yolo python 環境
====================
- miniconda3 [https://docs.conda.io/en/latest/miniconda.html](https://docs.conda.io/en/latest/miniconda.html)
- pip [https://pip.pypa.io/en/stable/installation/](https://pip.pypa.io/en/stable/installation/)
```
conda env list                  # 環境列表
conda list                      # 該環境的套件列表
conda activate rabbit           # 若機器重開機則需要重新啟用該環境

pip install -r requirements.txt # pip 安裝套件
```

# Getting Start

 step1: install the dependencies
 
 ```sh
npm install 
or
yarn install
 ```

 step2: Copy env file to env floder and Setup

```sh
$Name = APP NAME or Env Name

$HOST = APP IP (127.0.0.1))
$PORT = Service Port (80)
$SERVER_CACHE_EXPIRE = 86400000

# MySQL
$MYSQL_ACC_URL= 'mysql://user:pass@example.com:port/dbname'
$MYSQL_TENDER_URL= 'mysql://user:pass@example.com:port/dbname'
# PostgreSQL
$DATABASE_URL ='postgres://username:password@localhost/database'
# MSSQL
$MSSQL_USER='username'
$MSSQL_PWD='password'
$MSSQL_HOST='example.com'

$GCLOUD_KEY='{"CLIENT_EMAIL": "username@example.com", "PRIVATE_KEY": "privare key"}'

$DEBUG = Open Debug Mode (Boolen)
$SWAGGER = Open SWAGGER Page (Boolen)
$PINO = Open PINO Log System (Boolen)
$PRETTY_PRINT = PRETTY PRINT FOR PINO  (Boolen)
$BLIPP = Open Router List (Boolen)
$UPLOAD_PATH = '/path/to/save/images' (string) # 車巡上傳圖片所在位置

$TELEGRAM_BOT_TOKEN = ask the token with father
```

 step3: start project

 ```sh
npm start 
or
yarn start
 ```