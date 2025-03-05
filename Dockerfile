# 1. Node.js 베이스 이미지 선택
FROM node:18-alpine

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 패키지 복사 및 설치
COPY package*.json ./
RUN npm install --only=production

# 4. 소스 코드 복사
COPY . .

# 5. 포트 설정 (NestJS 포트 3001)
EXPOSE 3001

# 6. 실행 명령어 설정
CMD ["node", "dist/main"]
