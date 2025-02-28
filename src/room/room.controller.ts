// src/rooms/room.controller.ts
import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { RoomService } from './room.service';
import { Response } from 'express';
import { join } from 'path';

@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  // GET /room/:roomId
  @Get(':roomId')
  async getRoom(@Param('roomId') roomId: string, @Res() res: Response) {
    try {
      // Redis에서 방 정보를 확인 (실제 운영에서는 이 정보를 템플릿에 전달할 수 있습니다)
      const roomInfo = await this.roomService.getRoomInfo(roomId);
      // 방 정보가 존재하면 정적 HTML 파일(예: public/index.html)을 전송합니다.
      const filePath = join(__dirname, '../../public/index.html');
      return res.sendFile(filePath);
    } catch (error) {
      // 방 정보가 없으면 에러 응답 처리 (예: 404 Not Found)
      return res.status(404).send(`Room ${roomId} not found`);
    }
  }
}
