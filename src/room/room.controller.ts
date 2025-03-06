import { Controller, Get, Param, Res, NotFoundException, BadRequestException } from '@nestjs/common';
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
      // Redis에서 방 정보를 확인
      const roomInfo = await this.roomService.getRoomInfo(roomId);

      throw new Error("test로 그냥 발생시킨 에러입니다")

      // 방 정보가 존재하면 정적 HTML 파일(예: public/index.html)을 전송합니다.
      const filePath = join(__dirname, '../../public/index.html');
      return res.sendFile(filePath);
    } catch (error) {
      // 예외가 발생하면 NestJS의 예외 핸들러가 자동으로 처리
      throw error;
    }
  }
}
