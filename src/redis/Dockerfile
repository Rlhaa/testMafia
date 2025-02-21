# Redis 공식 이미지를 베이스 이미지로 사용
FROM redis:latest

# 로컬에 있는 redis.conf 파일을 컨테이너 내 설정 파일 위치로 복사합니다.
COPY redis.conf /usr/local/etc/redis/redis.conf

# redis.conf 파일을 사용하여 Redis 서버를 실행합니다.
CMD [ "redis-server", "/usr/local/etc/redis/redis.conf" ]
