import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { createTicket, getTicketById, listTickets, payTicket } from '../services/tickets.js';
import {
  CreateTicketBodySchema,
  ListTicketsQuerySchema,
  PayTicketBodySchema,
  TicketIdParamsSchema,
} from '../types/index.js';
import { parseOrThrow } from './validate.js';

export const ticketRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.post('/tickets', async (request, reply) => {
    const body = parseOrThrow(CreateTicketBodySchema, request.body, 'ticket');
    const ticket = await createTicket(db, body);
    return reply.status(201).send(ticket);
  });

  app.get('/tickets', async (request) => {
    const { limit, offset } = parseOrThrow(ListTicketsQuerySchema, request.query, 'query');
    return listTickets(db, limit, offset);
  });

  app.get('/tickets/:id', async (request) => {
    const { id } = parseOrThrow(TicketIdParamsSchema, request.params, 'ticket id');
    return getTicketById(db, id);
  });

  app.post('/tickets/:id/pay', async (request) => {
    const { id } = parseOrThrow(TicketIdParamsSchema, request.params, 'ticket id');
    const body = parseOrThrow(PayTicketBodySchema, request.body, 'payment');
    return payTicket(db, id, body);
  });
};
