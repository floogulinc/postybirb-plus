import * as fs from 'fs-extra';
import * as shortid from 'shortid';
import * as _ from 'lodash';
import { FileRecord } from 'src/submission/file-submission/interfaces/file-record.interface';
import { FileSubmission } from 'src/submission/file-submission/interfaces/file-submission.interface';
import { Injectable, Logger } from '@nestjs/common';
import { SUBMISSION_FILE_DIRECTORY, THUMBNAIL_FILE_DIRECTORY } from 'src/directories';
import { UploadedFile } from './uploaded-file.interface';
import { app, nativeImage } from 'electron';

@Injectable()
export class FileRepositoryService {
  private readonly logger: Logger = new Logger(FileRepositoryService.name);

  async insertFile(
    id: string,
    file: UploadedFile,
    path: string,
  ): Promise<{ thumbnailLocation: string; submissionLocation: string }> {
    this.logger.debug(`Uploading file ${path} ${file.originalname}`);

    const idName = `${id}-${shortid.generate()}.${file.originalname.split('.').pop()}`;
    const submissionFilePath = `${SUBMISSION_FILE_DIRECTORY}/${idName}`;
    const insertSubmissionFile = await fs.outputFile(submissionFilePath, file.buffer);

    let thumbnail: Buffer = null;
    const thumbnailFilePath = `${THUMBNAIL_FILE_DIRECTORY}/${idName}.jpeg`;
    if (file.mimetype.includes('image')) {
      if (file.mimetype.includes('gif')) {
        thumbnail = file.buffer;
      } else {
        const tmp = nativeImage.createFromBuffer(file.buffer);
        const sizes = tmp.getSize();
        thumbnail = tmp
          .resize({
            width: Math.min(sizes.width, 300),
            height: Math.min(sizes.height, 300),
          })
          .toPNG();
      }
    } else {
      thumbnail = (await app.getFileIcon(path)).toJPEG(100);
    }

    const insertThumbnailFile = await fs.outputFile(thumbnailFilePath, thumbnail);

    return {
      thumbnailLocation: thumbnailFilePath,
      submissionLocation: submissionFilePath,
    };
  }

  async removeSubmissionFiles(submission: FileSubmission) {
    this.logger.debug(`Removing files for ${submission.id}`);
    const files = [submission.primary, submission.thumbnail, ...(submission.additional || [])];
    const promises = _.flatten(
      files.filter(f => !!f).map(f => [fs.remove(f.location), fs.remove(f.preview)]),
    );
    await Promise.all(promises);
  }

  async copyFileWithNewId(id: string, file: FileRecord): Promise<FileRecord> {
    this.logger.debug(`Copying file ${file.location} with name ${id}`);
    const pathParts = file.location.split('/');
    pathParts.pop();
    const extension = file.location.split('.').pop();
    const newId = `${id}-${shortid.generate()}`;
    const filePath = [...pathParts, `${newId}.${extension}`].join('/');

    await fs.copy(file.location, filePath);

    const thumbPathParts = file.preview.split('/');
    thumbPathParts.pop();
    const thumbPath = [...thumbPathParts, `${newId}.jpeg`].join('/');

    await fs.copy(file.preview, thumbPath);

    // Set new file paths and return
    file.location = filePath;
    file.preview = thumbPath;
    return file;
  }
}
