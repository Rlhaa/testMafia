// src/rooms/room.controller.ts
import { Controller, Get, Param, Render } from '@nestjs/common';

@Controller('room')
export class RoomController {
  // GET /room/:roomId 로 접근하면 views/chat.ejs 템플릿을 렌더링
  @Get(':roomId')
  @Render('chat') // views 폴더 안에 chat.ejs 파일이 있어야 합니다.
  getRoom(@Param('roomId') roomId: string) {
    return { roomId };
  }
}
