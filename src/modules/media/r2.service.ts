import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/app-config.service';

/** Cloudflare R2 via the S3-compatible API. */
@Injectable()
export class R2Service implements OnModuleInit {
  private client!: S3Client;

  constructor(private readonly cfg: AppConfigService) {}

  onModuleInit() {
    const creds =
      this.cfg.r2AccessKeyId && this.cfg.r2SecretAccessKey
        ? {
            accessKeyId: this.cfg.r2AccessKeyId,
            secretAccessKey: this.cfg.r2SecretAccessKey,
          }
        : undefined;
    this.client = new S3Client({
      region: this.cfg.r2Region,
      endpoint: this.cfg.r2Endpoint,
      credentials: creds,
    });
  }

  async presignPut(params: {
    key: string;
    contentType: string;
  }): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.cfg.r2Bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: this.cfg.r2PresignExpires,
    });
  }

  async presignGet(key: string): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.r2Bucket,
      Key: key,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: this.cfg.r2PresignExpires,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.r2Bucket, Key: key }),
    );
  }

  get bucket() {
    return this.cfg.r2Bucket;
  }

  get presignExpiresSeconds() {
    return this.cfg.r2PresignExpires;
  }
}
