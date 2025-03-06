import { Controller, Get } from '@nestjs/common';
import axios from 'axios';

@Controller('get-server-info')
export class GameController {
  @Get()
  async getServerInfo() {
    try {
      const response = await axios.get(
        'http://169.254.169.254/latest/meta-data/public-ipv4',
      );
      return { publicIp: response.data };
    } catch (error) {
      return { error: 'Failed to retrieve server info' };
    }
  }
}
