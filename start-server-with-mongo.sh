#!/bin/bash
export AFI_MONGO_URI="mongodb+srv://afi-app:J2WR2u2yIYhGREFF@afiawscluster.c9sk16.mongodb.net/?retryWrites=true&w=majority&appName=AFI"
export AFI_PRICE_FEED_SOURCE=blofin
node dist/src/server.js

