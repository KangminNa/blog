import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { type Actor, CurrentActor, NotFound } from '../platform';
import { SkillQuery } from './skill.query';

// 관리 화면 기기 시트의 "스킬 받기": ChatGPT·Claude 앱에 올릴 스킬 zip (주인만)
@Controller('api/skills')
export class SkillController {
  constructor(private readonly skills: SkillQuery) {}

  @Get(':file')
  download(@CurrentActor() actor: Actor, @Param('file') file: string): StreamableFile {
    if (!file.endsWith('.zip')) throw new NotFound(`없는 파일이에요: ${file}`);
    const skill = this.skills.appPackage(actor, file.slice(0, -'.zip'.length));
    return new StreamableFile(skill.zip(), {
      type: 'application/zip',
      disposition: `attachment; filename="${skill.fileName}"`,
    });
  }
}
