# Use the official lightweight Node.js 16 image.
# https://hub.docker.com/_/node
FROM node:16-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./

# Install production dependencies.
RUN yarn install --production --ignore-engines && yarn cache clean

# Copy local code to the container image.
COPY . ./

# Expose the port the app runs on
EXPOSE 3004

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3004
ENV MYSQL_ACC_URL='mysql://bimuser:Bim23265946@mysqldb.bim-group.com:3306/account'
ENV MYSQL_TENDER_URL='mysql://bimuser:Bim23265946@mysqldb.bim-group.com:3306/tenderdb'
ENV DATABASE_URL='postgres://bimpglink:Bim23265946@mysqldb.bim-group.com:5432/tenderdb'
ENV MSSQL_USER='rm'
ENV MSSQL_PWD='rm'
ENV MSSQL_HOST='rmdb.bim-group.com'
ENV DEBUG=true
ENV SWAGGER=true
ENV PINO=false
ENV PRETTY_PRINT=false
ENV BLIPP=true
ENV TZ='Etc/GMT'

# Run the web service on container startup.
CMD [ "yarn", "start" ]
