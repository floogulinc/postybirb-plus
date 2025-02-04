import { Injectable } from '@nestjs/common';
import { SubmissionRating } from 'postybirb-commons';
import {
  DefaultOptions,
  FileRecord,
  FileSubmission,
  FileSubmissionType,
  PostResponse,
  Submission,
  SubmissionPart,
  TwitterFileOptions,
} from 'postybirb-commons';
import UserAccountEntity from 'src/server//account/models/user-account.entity';
import { UsernameParser } from 'src/server/description-parsing/miscellaneous/username.parser';
import { PlaintextParser } from 'src/server/description-parsing/plaintext/plaintext.parser';
import ImageManipulator from 'src/server/file-manipulation/manipulators/image.manipulator';
import Http from 'src/server/http/http.util';
import { CancellationToken } from 'src/server/submission/post/cancellation/cancellation-token';
import { FilePostData } from 'src/server/submission/post/interfaces/file-post-data.interface';
import { PostData } from 'src/server/submission/post/interfaces/post-data.interface';
import { ValidationParts } from 'src/server/submission/validator/interfaces/validation-parts.interface';
import FileSize from 'src/server/utils/filesize.util';
import FormContent from 'src/server/utils/form-content.util';
import { OAuthUtil } from 'src/server/utils/oauth.util';
import WebsiteValidator from 'src/server/utils/website-validator.util';
import { LoginResponse } from '../interfaces/login-response.interface';
import { ScalingOptions } from '../interfaces/scaling-options.interface';
import { Website } from '../website.base';
import { TwitterAccountData } from './twitter-account.interface';

@Injectable()
export class Twitter extends Website {
  readonly BASE_URL = '';
  readonly acceptsAdditionalFiles = true;
  readonly enableAdvertisement = false;
  readonly defaultDescriptionParser = PlaintextParser.parse;
  readonly acceptsFiles = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'mp4', 'mov'];
  readonly usernameShortcuts = [
    {
      key: 'tw',
      url: 'https://twitter.com/$1',
    },
  ];

  getScalingOptions(file: FileRecord): ScalingOptions {
    return { maxSize: FileSize.MBtoBytes(5) };
  }

  preparseDescription(text: string) {
    return UsernameParser.replaceText(text, 'tw', '@$1');
  }

  async checkLoginStatus(data: UserAccountEntity): Promise<LoginResponse> {
    const status: LoginResponse = { loggedIn: false, username: null };
    const accountData: TwitterAccountData = data.data;
    if (accountData && accountData.oauth_token) {
      status.loggedIn = true;
      status.username = accountData.screen_name;
    }
    return status;
  }

  async postFileSubmission(
    cancellationToken: CancellationToken,
    data: FilePostData<TwitterFileOptions>,
    accountData: TwitterAccountData,
  ): Promise<PostResponse> {
    let contentBlur = data?.options?.contentBlur;

    const form: any = {
      token: accountData.oauth_token,
      secret: accountData.oauth_token_secret,
      title: '',
      description: data.description,
      tags: data.tags,
      files: [data.primary, ...data.additional].map(f => ({
        data: f.file.value.toString('base64'),
        ...f.file.options,
      })),
      rating: data.rating,
      options: {
        contentBlur,
      },
    };

    this.checkCancelled(cancellationToken);
    const post = await Http.post<{ success: boolean; data: any; error: string }>(
      OAuthUtil.getURL('twitter/v2/post'),
      undefined,
      {
        type: 'json',
        data: form,
        requestOptions: { json: true },
      },
    );

    if (post.body.success) {
      return this.createPostResponse({ source: post.body.data.url });
    }

    return Promise.reject(
      this.createPostResponse({ additionalInfo: post.body, message: post.body.error }),
    );
  }

  async postNotificationSubmission(
    cancellationToken: CancellationToken,
    data: PostData<Submission, DefaultOptions>,
    accountData: TwitterAccountData,
  ): Promise<PostResponse> {
    const form: any = {
      token: accountData.oauth_token,
      secret: accountData.oauth_token_secret,
      title: '',
      description: data.description,
      tags: data.tags,
      rating: data.rating,
      options: {},
    };

    this.checkCancelled(cancellationToken);
    const post = await Http.post<{ success: boolean; data: { url: string }; error: string }>(
      OAuthUtil.getURL('twitter/v2/post'),
      undefined,
      {
        type: 'json',
        data: form,
        requestOptions: { json: true },
      },
    );

    if (post.body.success) {
      return this.createPostResponse({ source: post.body.data.url });
    }

    return Promise.reject(
      this.createPostResponse({ additionalInfo: post.body, message: post.body.error }),
    );
  }

  validateFileSubmission(
    submission: FileSubmission,
    submissionPart: SubmissionPart<TwitterFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const problems: string[] = [];
    const warnings: string[] = [];
    const isAutoscaling: boolean = submissionPart.data.autoScale;

    const description = PlaintextParser.parse(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
      23,
    );

    if (description.length > 280) {
      warnings.push(
        `Approximated description may surpass 280 character limit (${description.length})`,
      );
    }

    const files = [
      submission.primary,
      ...(submission.additional || []).filter(
        f => !f.ignoredAccounts!.includes(submissionPart.accountId),
      ),
    ];

    files.forEach(file => {
      const { type, size, name, mimetype } = file;
      if (!WebsiteValidator.supportsFileType(file, this.acceptsFiles)) {
        problems.push(`Does not support file format: (${name}) ${mimetype}.`);
      }

      let maxMB: number = mimetype === 'image/gif' ? 15 : 5;
      if (type === FileSubmissionType.VIDEO) {
        maxMB = 15;
      }
      if (FileSize.MBtoBytes(maxMB) < size) {
        if (
          isAutoscaling &&
          type === FileSubmissionType.IMAGE &&
          ImageManipulator.isMimeType(mimetype)
        ) {
          warnings.push(`${name} will be scaled down to ${maxMB}MB`);
        } else {
          problems.push(`Twitter limits ${mimetype} to ${maxMB}MB`);
        }
      }
    });

    return { problems, warnings };
  }

  validateNotificationSubmission(
    submission: Submission,
    submissionPart: SubmissionPart<TwitterFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const warnings = [];

    const description = PlaintextParser.parse(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
      23,
    );

    if (description.length > 280) {
      warnings.push(
        `Approximated description may surpass 280 character limit (${description.length})`,
      );
    }

    return { problems: [], warnings };
  }
}
