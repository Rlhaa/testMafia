import { Controller, Get } from '@nestjs/common';
import axios from 'axios';

@Controller('get-server-info')
export class GameController {
  @Get()
  async getServerInfo() {
    try {
      if (process.env.NODE_ENV === 'development') {
        return { publicIp: '127.0.0.1' }; // 로컬 테스트용
      }

      // ✅ checkip.amazonaws.com에서 퍼블릭 IP 가져오기
      const response = await axios.get('http://checkip.amazonaws.com');
      const publicIp = response.data.trim(); // 공백 제거

      return { publicIp };
    } catch (error) {
      return {
        error: 'Failed to retrieve server info',
        details: error.message,
      };
    }
  }
}
