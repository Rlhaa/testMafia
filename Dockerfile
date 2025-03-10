# 1. Node.js 베이스 이미지 선택
FROM node:18-alpine

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. package.json 복사 및 전체 패키지 설치
COPY package*.json ./
RUN npm install  # --only=production 제거

# 4. 소스 코드 복사
COPY . .

# 5. NestJS 빌드 실행 (dist 폴더 생성됨)
RUN npm run build

# 6. 포트 설정 (NestJS 기본 3000)
EXPOSE 3001

# 7. 실행 명령어
CMD ["node", "dist/main"]
