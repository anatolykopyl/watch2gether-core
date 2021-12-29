import Koa from 'koa';
import Router from 'koa-router';
require('dotenv').config();

import json from 'koa-json';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';

import fs from 'fs';
import mv from 'mv';
import { model, connect } from 'mongoose';
import short from 'short-uuid';
import WebTorrent from 'webtorrent';

import { errorResponse, findInDir } from './utils';
import { Room, roomSchema } from './interfaces';

const RoomModel = model<Room>('Room', roomSchema);

const tCli = new WebTorrent();

const app = new Koa();
const router = new Router({ prefix: '/api' });

router.post('/room', async (ctx) => {
  return new Promise(function (resolve) {
    tCli.add(ctx.request.body.magnet, { path: process.env.TEMP_FILES }, async function (torrent) {
      const room = {
        id: (short()).new(),
        magnet: ctx.request.body.magnet,
        createdAt: new Date(),
        movie: torrent.name,
        position: 0,
      };
      const doc = new RoomModel(room);

      torrent.on('done', function () {
        findInDir(torrent.path, /\.mp4$/, (filename: string) => {
          mv(`./${filename}`, `${process.env.FILES}/${room.id}.mp4`, () => {
            doc.downloaded = true;
            doc.downloadedAt = new Date();
            doc.save();
            fs.rmSync(__dirname + '/../' + torrent.path + '/' + torrent.name, { recursive: true });
          });
        });
      });

      await doc.save();
      ctx.body = room;
      resolve(null);
    });
  });
});

router.get('/room', async (ctx) => {
  const room = await RoomModel.findOne({ id: ctx.request.query.id }).exec();
  if (room) {
    ctx.body = room;  
  } else {
    ({ status: ctx.status, body: ctx.body } = errorResponse('room-00', 'Room not found'));
  }
});

router.post('/position', async (ctx) => {
  await RoomModel.updateOne({ id: ctx.request.body.id }, { position: Number(ctx.request.body.position) });
  ctx.body = 'success';
});

router.get('/position', async (ctx) => {
  const room = await RoomModel.findOne({ id: ctx.request.query.id }).exec();
  if (room) {
    ctx.body = {
      position: room.position,
    };
  } else {
    ({ status: ctx.status, body: ctx.body } = errorResponse('room-00', 'Room not found'));
  }
});

// Лучше спрятать в вебсокет?
router.get('/status', async (ctx) => {
  const room = await RoomModel.findOne({ id: ctx.request.query.id }).exec();

  if (room) {
    const torrent = tCli.get(room.magnet);
    if (torrent) {
      ctx.body = {
        progress: (torrent as WebTorrent.Torrent).progress,
        downloaded: room.downloaded,
      };
    } else {
      ({ status: ctx.status, body: ctx.body } = errorResponse('status-00', 'No torrent found'));
    }
  } else {
    ({ status: ctx.status, body: ctx.body } = errorResponse('status-01', 'No room found'));
  }
});

app.use(json());
app.use(bodyParser());
app.use(cors({
  credentials: true,
}));
app.use(router.routes());
app.use(router.allowedMethods());

connect(process.env.DB).then(() => {
  app.listen(process.env.PORT);
  console.log(`💡 Core api live on port ${process.env.PORT}`);
});
