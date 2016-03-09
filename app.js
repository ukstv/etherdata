var async = require( 'async' );
var https = require( 'https' );
var pg = require( 'pg' );
var conString = "postgres://etherreader:password@localhost/etherdb";
var express = require( 'express' );
var bodyParser = require( 'body-parser' );
var _ = require ( 'underscore' );

var app = express();
var jsonParser = bodyParser.json();
var lastRequest = new Date();
var currencies;

app.use( jsonParser );

app.logger = require( './lib/logger' );

app.logger.initialize( app, 4 );

function getLastBlock( req, client, done ) {
  var sql = 'SELECT number FROM blocks b ORDER BY b.number DESC LIMIT 1';
  app.logger.logQuery( 'lastblock', { sql: sql, values: [] } );
  client.query(sql, [], function(err, result) {
    if( err ) {
      return done( err );
    }

    if ( result && result.rows && result.rows.length ) {
      return done( null, result.rows[0].number );
    }

    return done( null, -1 ); // TODO: bigint!
  });
}

function getTransactions( req, client, done ) {
  if ( !req || !req.body || !req.body.accounts || !req.body.accounts.length ) {
    return done( 'Invalid request' );
  }

  var values = [];
  var params = [];
  for ( var i = 0; i < req.body.accounts.length; i++ ) {
    params.push( '$' + (i + 1) );
    values.push( req.body.accounts[i] );
  }

  var paramStr = params.join(',');
  var sql = 'SELECT hash, blocknumber FROM transactions t WHERE t.from IN (' + paramStr + ') OR t.to IN (' + paramStr + ')';
  app.logger.logQuery( 'transactions', { sql: sql, values: values } );
  client.query(sql, values, function(err, result) {
    if( err ) {
      return done( err );
    }

    if ( result && result.rows && result.rows.length ) {
      return done( null, result.rows );
    }

    return done( null, [] );
  });
}

pg.connect(conString, function(err, client, done) {
  if(err) {
    return console.error( err );
  }

  app.post('/api/lastblock', function (req, res) {
    var diff = new Date() - lastRequest;
//    if ( diff < 500 ) { // 2x per second
//        return res.status(403).send( { success: false, error: 'Too many request, try again later' } );
//    }
    lastRequest = new Date();
    getLastBlock( req, client, function ( err, result ) {
      if ( err ) {
        app.logger.logError( err );
        return res.status(400).send( { success: false, error: err } );
      }
      res.send({ success: true, result: result });
    } );
  });

  app.post('/api/transactions', function (req, res) {
    var diff = new Date() - lastRequest;
//    if ( diff < 500 ) { // 2x per second
//        return res.status(403).send( { success: false, error: 'Too many request, try again later' } );
//    }
    lastRequest = new Date();
    getTransactions( req, client, function ( err, result ) {
      if ( err ) {
        app.logger.logError( err );
        return res.status(400).send( { success: false, error: err } );
      }
      res.send({ success: true, result: result });
    } );
  });

  app.post('/api/currencies', function( req, res ) {
    var now = new Date().valueOf();
    if ( !currencies || ( now - currencies.date ) > 1000 * 300 ) { // older than 5m
      var data = '';
      console.log( 'Requesting prices' );

      https.get('https://www.cryptocompare.com/api/data/price?fsym=ETH&tsyms=USD,CAD,EUR,GBP',
      function( r ) {
        r.on( 'error', function( err ) {
          console.error( err );
          return res.send( { success: false, error: err } );
        } );

        r.on( 'data', function( d ) {
          data += String(d);
        } );

        r.on( 'end', function() {
          try {
            currencies = JSON.parse( data );
            currencies.date = new Date().valueOf();
            res.send( { success: true, currencies: currencies } );
          } catch ( err ) {
            res.send( { success: false, error: err } );
          }
        } );
      } );
    } else {
      res.send( { success: true, currencies: currencies } );
    }
  });

  var server = app.listen(3000, 'localhost', function () {
    var host = server.address().address;
    var port = server.address().port;

    app.logger.logInfo('App listening at http://' + host + ':' + port);
  });
} );