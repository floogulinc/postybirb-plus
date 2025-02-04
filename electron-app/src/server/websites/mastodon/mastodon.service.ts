import { Injectable } from '@nestjs/common';
import generator, { Entity, Response } from 'megalodon';
import {
  DefaultOptions,
  FileRecord,
  FileSubmission,
  FileSubmissionType,
  MastodonAccountData,
  MastodonFileOptions,
  MastodonNotificationOptions,
  PostResponse,
  Submission,
  SubmissionPart,
  SubmissionRating,
} from 'postybirb-commons';
import { ScalingOptions } from '../interfaces/scaling-options.interface';
import UserAccountEntity from 'src/server//account/models/user-account.entity';
import { PlaintextParser } from 'src/server/description-parsing/plaintext/plaintext.parser';
import ImageManipulator from 'src/server/file-manipulation/manipulators/image.manipulator';
import Http from 'src/server/http/http.util';
import { CancellationToken } from 'src/server/submission/post/cancellation/cancellation-token';
import {
  FilePostData,
  PostFile,
} from 'src/server/submission/post/interfaces/file-post-data.interface';
import { PostData } from 'src/server/submission/post/interfaces/post-data.interface';
import { ValidationParts } from 'src/server/submission/validator/interfaces/validation-parts.interface';
import FileSize from 'src/server/utils/filesize.util';
import FormContent from 'src/server/utils/form-content.util';
import WebsiteValidator from 'src/server/utils/website-validator.util';
import { LoginResponse } from '../interfaces/login-response.interface';
import { Website } from '../website.base';
import _ from 'lodash';
import WaitUtil from 'src/server/utils/wait.util';
import { FileManagerService } from 'src/server/file-manager/file-manager.service';

const INFO_KEY = 'INSTANCE INFO';

type MastodonInstanceInfo = {
  configuration: {
    statuses: {
      max_characters: number;
      max_media_attachments: number;
    };
    media_attachments: {
      supported_mime_types: string[];
      image_size_limit: number;
      video_size_limit: number;
    };
  };
};

@Injectable()
export class Mastodon extends Website {
  constructor(private readonly fileRepository: FileManagerService) {
    super();
  }
  readonly BASE_URL: string;
  readonly enableAdvertisement = false;
  readonly acceptsAdditionalFiles = true;
  readonly defaultDescriptionParser = PlaintextParser.parse;
  readonly acceptsFiles = [
    'png',
    'jpeg',
    'jpg',
    'gif',
    'swf',
    'flv',
    'mp4',
    'doc',
    'rtf',
    'txt',
    'mp3',
  ];

  async checkLoginStatus(data: UserAccountEntity): Promise<LoginResponse> {
    const status: LoginResponse = { loggedIn: false, username: null };
    const accountData: MastodonAccountData = data.data;
    if (accountData && accountData.token) {
      await this.getAndStoreInstanceInfo(data._id, accountData);

      status.loggedIn = true;
      status.username = accountData.username;
    }
    return status;
  }

  private async getAndStoreInstanceInfo(profileId: string, data: MastodonAccountData) {
    const client = generator('mastodon', data.website, data.token);
    const instance = await client.getInstance();

    this.storeAccountInformation(profileId, INFO_KEY, instance.data);
  }

  getScalingOptions(file: FileRecord, accountId: string): ScalingOptions {
    const instanceInfo: MastodonInstanceInfo = this.getAccountInfo(accountId, INFO_KEY);
    return instanceInfo?.configuration?.media_attachments
      ? {
          maxHeight: 4000,
          maxWidth: 4000,
          maxSize:
            file.type === FileSubmissionType.IMAGE
              ? instanceInfo.configuration.media_attachments.image_size_limit
              : instanceInfo.configuration.media_attachments.video_size_limit,
        }
      : {
          maxHeight: 4000,
          maxWidth: 4000,
          maxSize: FileSize.MBtoBytes(300),
        };
  }

  // Megaladon api has uploadMedia method, hovewer, it does not work with mastodon
  private async uploadMedia(
    data: MastodonAccountData,
    file: PostFile,
    altText: string,
  ): Promise<string> {
    const upload = await Http.post<{ id: string; errors: any; url: string }>(
      `${data.website}/api/v2/media`,
      undefined,
      {
        type: 'multipart',
        data: {
          file,
          description: altText,
        },
        requestOptions: { json: true },
        headers: {
          Accept: '*/*',
          'User-Agent': 'node-mastodon-client/PostyBirb',
          Authorization: `Bearer ${data.token}`,
        },
      },
    );

    this.verifyResponse(upload, 'Verify upload');

    // Processing
    if (upload.response.statusCode === 202 || !upload.body.url) {
      for (let i = 0; i < 10; i++) {
        await WaitUtil.wait(4000);
        const checkUpload = await Http.get<{ id: string; errors: any; url: string }>(
          `${data.website}/api/v1/media/${upload.body.id}`,
          undefined,
          {
            requestOptions: { json: true },
            headers: {
              Accept: '*/*',
              'User-Agent': 'node-mastodon-client/PostyBirb',
              Authorization: `Bearer ${data.token}`,
            },
          },
        );

        if (checkUpload.body.url) {
          break;
        }
      }
    }

    if (upload.body.errors) {
      return Promise.reject(
        this.createPostResponse({ additionalInfo: upload.body, message: upload.body.errors }),
      );
    }

    return upload.body.id;
  }

  async postFileSubmission(
    cancellationToken: CancellationToken,
    data: FilePostData<MastodonFileOptions>,
    accountData: MastodonAccountData,
  ): Promise<PostResponse> {
    const M = generator('mastodon', accountData.website, accountData.token);

    const files = [data.primary, ...data.additional];
    const uploadedMedias: string[] = [];
    for (const file of files) {
      this.checkCancelled(cancellationToken);
      uploadedMedias.push(await this.uploadMedia(accountData, file.file, data.options.altText));
    }

    const instanceInfo: MastodonInstanceInfo = this.getAccountInfo(data.part.accountId, INFO_KEY);
    const chunkCount = instanceInfo?.configuration?.statuses?.max_media_attachments ?? 4;
    const maxChars = instanceInfo?.configuration?.statuses?.max_characters ?? 500;

    const isSensitive = data.rating !== SubmissionRating.GENERAL;
    const chunks = _.chunk(uploadedMedias, chunkCount);
    let status = `${data.options.useTitle && data.title ? `${data.title}\n` : ''}${
      data.description
    }`.substring(0, maxChars);
    let lastId = '';
    let source = '';

    for (let i = 0; i < chunks.length; i++) {
      this.checkCancelled(cancellationToken);
      const statusOptions: any = {
        sensitive: isSensitive,
        visibility: data.options.visibility || 'public',
        media_ids: chunks[i],
      };

      if (i !== 0) {
        statusOptions.in_reply_to_id = lastId;
      }
      if (data.options.spoilerText) {
        statusOptions.spoiler_text = data.options.spoilerText;
      }

      status = this.appendTags(this.formatTags(data.tags), status, maxChars);

      try {
        const result = (await M.postStatus(status, statusOptions)).data as Entity.Status;
        if (!source) source = result.url;
        lastId = result.id;
      } catch (err) {
        return Promise.reject(
          this.createPostResponse({
            message: err.message,
            stack: err.stack,
            additionalInfo: { chunkNumber: i },
          }),
        );
      }
    }

    this.checkCancelled(cancellationToken);

    return this.createPostResponse({ source });
  }

  async postNotificationSubmission(
    cancellationToken: CancellationToken,
    data: PostData<Submission, MastodonNotificationOptions>,
    accountData: MastodonAccountData,
  ): Promise<PostResponse> {
    const M = generator('mastodon', accountData.website, accountData.token);
    const instanceInfo: MastodonInstanceInfo = this.getAccountInfo(data.part.accountId, INFO_KEY);
    const maxChars = instanceInfo?.configuration?.statuses?.max_characters ?? 500;

    const isSensitive = data.rating !== SubmissionRating.GENERAL;
    const statusOptions: any = {
      sensitive: isSensitive,
      visibility: data.options.visibility || 'public',
    };
    let status = `${data.options.useTitle && data.title ? `${data.title}\n` : ''}${
      data.description
    }`;
    if (data.options.spoilerText) {
      statusOptions.spoiler_text = data.options.spoilerText;
    }
    status = this.appendTags(this.formatTags(data.tags), status, maxChars);

    this.checkCancelled(cancellationToken);
    try {
      const result = (await M.postStatus(status, statusOptions)).data as Entity.Status;
      return this.createPostResponse({ source: result.url });
    } catch (error) {
      return Promise.reject(this.createPostResponse(error));
    }
  }

  formatTags(tags: string[]) {
    return this.parseTags(
      tags
        .map(tag => tag.replace(/[^a-z0-9]/gi, ' '))
        .map(tag =>
          tag
            .split(' ')
            // .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(''),
        ),
      { spaceReplacer: '_' },
    ).map(tag => `#${tag}`);
  }

  validateFileSubmission(
    submission: FileSubmission,
    submissionPart: SubmissionPart<MastodonFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const problems: string[] = [];
    const warnings: string[] = [];
    const isAutoscaling: boolean = submissionPart.data.autoScale;

    const description = this.defaultDescriptionParser(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
    );

    const instanceInfo: MastodonInstanceInfo = this.getAccountInfo(
      submissionPart.accountId,
      INFO_KEY,
    );
    const maxChars = instanceInfo?.configuration?.statuses?.max_characters ?? 500;

    if (description.length > maxChars) {
      warnings.push(
        `Max description length allowed is ${maxChars} characters (for this Mastodon client).`,
      );
    }

    const files = [
      submission.primary,
      ...(submission.additional || []).filter(
        f => !f.ignoredAccounts!.includes(submissionPart.accountId),
      ),
    ];

    const maxImageSize =
      instanceInfo?.configuration?.media_attachments?.image_size_limit ?? FileSize.MBtoBytes(50);

    files.forEach(file => {
      const { type, size, name, mimetype } = file;
      if (!WebsiteValidator.supportsFileType(file, this.acceptsFiles)) {
        problems.push(`Does not support file format: (${name}) ${mimetype}.`);
      }

      if (maxImageSize < size) {
        if (
          isAutoscaling &&
          type === FileSubmissionType.IMAGE &&
          ImageManipulator.isMimeType(mimetype)
        ) {
          warnings.push(`${name} will be scaled down to ${FileSize.BytesToMB(maxImageSize)}MB`);
        } else {
          problems.push(`Mastodon limits ${mimetype} to ${FileSize.BytesToMB(maxImageSize)}MB`);
        }
      }

      // Check the image dimensions are not over 4000 x 4000 - this is the Mastodon server max
      if (
        isAutoscaling &&
        type === FileSubmissionType.IMAGE &&
        (file.height > 4000 || file.width > 4000)
      ) {
        warnings.push(
          `${name} will be scaled down to a maximum size of 4000x4000, while maintaining aspect ratio`,
        );
      }
    });

    if (
      (submissionPart.data.tags.value.length > 1 || defaultPart.data.tags.value.length > 1) &&
      submissionPart.data.visibility != 'public'
    ) {
      warnings.push(
        `This post won't be listed under any hashtag as it is not public. Only public posts can be searched by hashtag.`,
      );
    }

    return { problems, warnings };
  }

  validateNotificationSubmission(
    submission: Submission,
    submissionPart: SubmissionPart<MastodonNotificationOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const warnings = [];
    const description = this.defaultDescriptionParser(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
    );

    const instanceInfo: MastodonInstanceInfo = this.getAccountInfo(
      submissionPart.accountId,
      INFO_KEY,
    );
    const maxChars = instanceInfo?.configuration?.statuses?.max_characters ?? 500;
    if (description.length > maxChars) {
      warnings.push(
        `Max description length allowed is ${maxChars} characters (for this Mastodon client).`,
      );
    }

    return { problems: [], warnings };
  }
}
