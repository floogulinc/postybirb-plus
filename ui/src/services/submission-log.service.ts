import axios from '../utils/http';
import { SubmissionType } from 'postybirb-commons';
import { SubmissionLog } from '../../../electron-app/src/server/submission/log/interfaces/submission-log.interface';

export default class SubmissionLogService {
  static getLogs(type: SubmissionType) {
    return axios.get<SubmissionLog[]>(`/submission-log/${type}`).then(({ data }) => data);
  }
}
