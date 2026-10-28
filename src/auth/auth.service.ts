import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/schemas/user.schema.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.users.exists({ email })) {
      throw new ConflictException('Email is already registered');
    }
    const user = await this.users.create({
      ...dto,
      email,
      password: await bcrypt.hash(dto.password, 10),
    });
    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users
      .findOne({ email: dto.email.toLowerCase() })
      .select('+password');
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return { data: { user } };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.findByIdAndUpdate(userId, dto, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!user) throw new NotFoundException('User not found');
    return { data: { user } };
  }

  private async issueToken(user: UserDocument) {
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return { token, data: { user } };
  }
}
