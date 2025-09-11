import { Injectable } from "@nestjs/common";
import { ClientsService } from "../clients/clients.service";

// the topcoder-healthcheck-dropin library returns checksRun count,
// here it follows that to return such count
let checksRun = 0;
@Injectable()
export class HealthService {
  constructor(private readonly service: ClientsService) {}

  async check(req, res) {
    // perform a quick database access operation, if there is no error and is quick, then consider it healthy;
    // there are just a few challenge types, so search challenge types should be efficient operation,
    // and it just searches a single challenge type, it should be quick operation
    checksRun += 1;
    const timestampMS = new Date().getTime();
    try {
      await this.service.get('1');
    } catch (e) {
      res.status(503).send({
        checksRun,
        message: `Error in DB access: ${e.message || e}. Timestamp: ${timestampMS}`,
      });
      return;
    }
    // there is no error, and it is quick, then return checks run count
    res.send({ checksRun });
  }
}
