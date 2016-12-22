import 'babel-polyfill';
import urlTemplate from 'url-template';
import HJSON from 'hjson';
import path from 'path';
import appRoot from 'app-root-path';
import debug from 'debug';
import _ from 'lodash/fp';
import fs from 'fs';
import {logger} from './logger';
import {gitterClients} from './gitter-clients';
import {
	getFileWriteStream, 
	saveMessages, 
	saveError,
} from './save-messages';
import {env} from './app-config';
import {pickDeepAll} from './util';
import cyclicNext from 'cyclic-next';

const log = debug('gitter-archive');

const {GITTER_HOST = 'api.gitter.im', GITTER_API_VERSION = 'v1', GITTER_TOKEN = ''} = env;

const getEarliestMessageId = _.flow(_.first, _.get('id'));

let totalMessagesRetrieved = 0;

const getNextGitterClient = (() => {
	let clientIdx = 0;
	return () => {
		const client = gitterClients[clientIdx];
		const totalClients = _.size(gitterClients);
		clientIdx = cyclicNext(totalClients, clientIdx);
		return client;
	};
})();

const fetchAllRoomMessagesAsync = async ({roomId, beforeId, skip = 0, ...restparam} = {}) => {
	const {groupId, roomUri, hasErrors = false, errorWriter, messageWriter, store} = restparam;
	store.updateRoom({id: roomId}, 'beforeId', beforeId);
	store.updateRoom({id: roomId}, 'skip', skip);

	try {
		// get a message set
		const {messages} = await getNextGitterClient().getChatMessages({
			roomId,
			beforeId,
			skip,
		});

		const messagesCount = _.size(messages);
		totalMessagesRetrieved += messagesCount;
		logger.info(`Room Messages Count = ${messagesCount}`);
		logger.info(`Total Room Messages Retrieved = ${totalMessagesRetrieved}`);
		
		saveMessages({writer: messageWriter, messages, roomId, roomUri});

		// for message set less than LIMIT = 100, mark completion of the room archive
		if (messagesCount < 100) {
			const errorMessage = hasErrors ? 'with errors' : 'with no errors';
			logger.info(`Room: ${roomUri} (${roomId}) archive completed ${errorMessage}.`);
			store.updateRoom({id: roomId}, 'isArchived', true);
			logger.close();
			return undefined;
		}

		const __beforeId = getEarliestMessageId(messages);
		store.updateRoom({id: roomId}, 'beforeId', __beforeId);
		store.updateRoom({id: roomId}, 'skip', skip);
		return fetchAllRoomMessagesAsync({roomId, beforeId: __beforeId, skip, hasErrors, groupId, roomUri, errorWriter, messageWriter, store});
	} catch (err) {
		console.error(err);
		saveError({writer: errorWriter, error: err, roomId, beforeId, skip, roomUri});
		logger.close();
	}
};

module.exports = {
	fetchAllRoomMessagesAsync,
	getFileWriteStream,
	gitterClients,
	getNextGitterClient,
	logger,
	pickDeepAll,
};
