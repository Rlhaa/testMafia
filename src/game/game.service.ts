import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GameService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis, // Redis 클라이언트 주입
  ) {}

  // createGame
  // - 새로운 게임 ID를 생성하고, 초기 게임 상태를 Redis에 저장합니다.
  // - 초기 상태에는 현재 방의 플레이어 목록(플레이어 정보는 JSON 문자열)도 포함됩니다.
  async createGame(roomId: string): Promise<string> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const gameId = uuidv4(); // 고유 게임 ID 생성
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    // console.log('Game ID:', gameId);
    // console.log('Redis Key:', redisKey);

    // 방에 저장된 플레이어 목록 가져오기
    const roomPlayersData = await this.redisClient.hget(
      `room:${roomId}`,
      'players',
    );

    // 플레이어 빈 배열 생성ㅇ 후
    let players = [];
    if (roomPlayersData) {
      try {
        // 저장된 플레이어 목록을 JSON으로 파싱
        players = JSON.parse(roomPlayersData);
      } catch (error) {
        players = [];
      }
    }

    // 초기 게임 상태 구성
    const initialGameState = {
      day: '1',
      phase: 'morning',
      mafiaCount: '2',
      citizenCount: '6',
      firstVote: JSON.stringify([]),
      secondVote: JSON.stringify([]),
      targetId: JSON.stringify([]),
      players: JSON.stringify(players), // 이전에 파싱한 플레이어 목록 반영
    };

    // 첫 시작 단계에서의 정보 레디스에 저장
    await this.redisClient.hmset(redisKey, initialGameState); // 초기 상태 저장
    return gameId; // 게임 ID 반환
  }

  // getGameData
  // - Redis에서 게임 데이터를 조회하고, JSON 파싱된 플레이어 목록을 반환합니다.
  async getGameData(roomId: string, gameId: string): Promise<any> {
    // 인자 예외 처리
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    // 들어온 인자로 redis key 구성 후
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    // 레디스 서버에 해당 키의 게임이 존재하는지 조회
    const gameData = await this.redisClient.hgetall(redisKey); // 게임 데이터 조회
    // 없을 때 예외처리
    if (!gameData || Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    // players 필드에 JSON 파싱을 수행하여 배열로 변환
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    // 게임 데이터 반환
    return gameData;
  }

  // assignRoles
  // - 방의 플레이어 수가 8명인지 확인한 후, 고정 역할 풀을 무작위로 섞어 각 플레이어에게 역할을 할당합니다.
  // - 역할 분배가 완료되면 업데이트된 플레이어 목록과 게임 phase 정보를 Redis에 저장하고, 업데이트된 배열을 반환합니다.
  async assignRoles(roomId: string, gameId: string): Promise<any> {
    // 들어온 인자로 redis key 구성 후
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    // getGameData 메서드를 통해 현재 게임 정보 조회
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    // 메서드에서 반환된 게임 정보 중 players 배열을 players에 할당
    const players = gameData.players;
    const requiredPlayers = 8;
    console.log('플레이어 수:', players.length);
    // players와 requiredPlayers 비교
    if (players.length !== requiredPlayers) {
      throw new BadRequestException(
        '플레이어 수가 8인이 아니므로 역할 분배를 진행할 수 없습니다.',
      );
    }

    // 고정된 역할 풀: mafia 2, citizen 4, police 1, doctor 1
    const rolesPool = [
      'mafia',
      'mafia',
      'citizen',
      'citizen',
      'citizen',
      'citizen',
      'police',
      'doctor',
    ];
    rolesPool.sort(() => Math.random() - 0.5); // 역할 풀 무작위 순서로 섞기

    // 각 플레이어 객체와 해당 객체의 인덱스가 콜백 함수의 매개변수로 전달
    const updatedPlayers = players.map((player, index) => ({
      // 콜백함수 내부
      // 스프레드 연산자로 객체 전개하여 새로운 객체 배열 생성
      ...player,
      // 그 객체에 할당 >> 모든 플렝이어에서 무작위로 섞은 직업이 분배
      role: rolesPool[index], // 역할 할당
      isAlive: true, // 초기 생존 상태 true 설정
    }));
    // console.log('Updated Players:', updatedPlayers);

    // 역할 부여 후 redis에 업데이트
    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    ); // 업데이트된 플레이어 목록 저장
    // 게임 페이즈 업데이트
    await this.redisClient.hset(redisKey, 'phase', 'rolesAssigned'); // 게임 phase 업데이트

    return updatedPlayers; // 업데이트된 배열 반환
  }
}
