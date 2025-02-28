# app/Dockerfile
FROM node:18

RUN mkdir -p /var/app
WORKDIR /var/app

# 소스 전체를 복사 (필요에 따라 .dockerignore로 불필요 파일 제거)
COPY . .

RUN npm install
RUN npm run build

EXPOSE 3000
CMD [ "node", "dist/main.js" ]
