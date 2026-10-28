import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum Role {
  Student = 'student',
  Instructor = 'instructor',
  Admin = 'admin',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true }) firstName: string;
  @Prop({ required: true, trim: true }) lastName: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;
  @Prop({ required: true, select: false }) password: string;
  @Prop({ type: String, enum: Role, default: Role.Student }) role: Role;
  @Prop() bio?: string;
  @Prop() avatar?: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// Never leak password hashes, even if a query selects them
UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const { password: _password, __v: _v, ...safe } = ret;
    return safe;
  },
});
