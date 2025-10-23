import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { Prisma } from "@prisma/client";
import { QueryClientsDto } from "./dto/query-clients.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { CreateClientDto } from "./dto/create-client.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: QueryClientsDto) {
    const where: Prisma.ClientWhereInput = {
      ...(q.name ? { name: { contains: q.name, mode: "insensitive" } } : {}),
      ...(q.codeName
        ? { codeName: { contains: q.codeName, mode: "insensitive" } }
        : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.startDateFrom || q.startDateTo
        ? {
            startDate: {
              gte: q.startDateFrom ? new Date(q.startDateFrom) : undefined,
              lte: q.startDateTo ? new Date(q.startDateTo) : undefined,
            },
          }
        : {}),
      ...(q.endDateFrom || q.endDateTo
        ? {
            endDate: {
              gte: q.endDateFrom ? new Date(q.endDateFrom) : undefined,
              lte: q.endDateTo ? new Date(q.endDateTo) : undefined,
            },
          }
        : {}),
    };

    const page = q.page || 1;
    const perPage = q.perPage || 20;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: q.sortBy
          ? { [q.sortBy]: q.sortOrder || "asc" }
          : { createdAt: "desc" },
      }),
    ]);

    return {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
      data: items,
    };
  }

  async get(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  async update(clientId: string, dto: UpdateClientDto) {
    return this.prisma.client.update({
      where: { id: clientId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.codeName !== undefined ? { codeName: dto.codeName } : {}),
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.startDate !== undefined
          ? { startDate: dto.startDate ? new Date(dto.startDate) : null }
          : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
          : {}),
      },
    });
  }

  async create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        name: dto.name,
        codeName: dto.codeName,
        status: (dto.status || "ACTIVE") as any,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }
}
