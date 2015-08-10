var BoxAPIClient = require('box-api');
var crypto = require('crypto');
var fs = require('fs');
var timestamp = require('internet-timestamp');
var path = require('path');
var walk = require('walk');
var debug = require('debug')('box-cli');

var VERSION = require('../package').version;

var program = require('commander');
program
  .version(VERSION)
  .option('--access-token <token>', 'OAuth Access Token');

program
  .command('upload <source> <destination>')
  .alias('u')
  .description('Upload files to Box')
  .option('--overwrite', 'Overwrite files with the same name')
  .option('--follow-links', 'Follow symlinks')
  .action(function(source, destination, options) {
    var client = new BoxAPIClient({ access_token: program.accessToken});
    fs.stat(source, function(err, stat) {
      if (err) throw err;
      var sourcePath = path.resolve(source);
      if (stat.isFile()) {
        sourcePath = path.dirname(sourcePath);
      }
      var walker = walk.walk(source, { followLinks: options.followLinks});
      var filesUploaded = 0;
      var filesSkipped = 0;
      var filesErrored = 0;
      walker.on('end', function() {
        console.log('%d files uploaded, %d files skipped, %d files errored', filesUploaded, filesSkipped, filesErrored);
      });
      walker.on('file', function(root, fileStat, next) {
        var uploadFolder = path.join(destination, path.relative(sourcePath, root));
        var uploadPath = path.join(uploadFolder, fileStat.name);
        var filePath = path.join(root, fileStat.name);

        client.folder.getByPath(uploadFolder, { create: true }, function(err, folder) {
          if (err) throw err;
          folder.findItemByName(fileStat.name, function(err, file) {
            if (err && err.name !== 'ItemNotFound') {
              throw err;
            }

            if (file && file.data.type !== 'file') {
              filesErrored += 1;
              console.log('err:', uploadPath, 'is a directory');
              return next();
            }

            var shasum = crypto.createHash('sha1');
            shasum.setEncoding('hex');

            var fileStream = fs.createReadStream(filePath);
            fileStream.pipe(shasum);
            fileStream.on('end', function() {
              shasum.end();
              var sha1 = shasum.read();
              if (!file) {
                folder.upload(fs.createReadStream(filePath), {
                  name: fileStat.name,
                  sha1: sha1,
                  content_created_at: timestamp(fileStat.ctime),
                  content_modified_at: timestamp(fileStat.mtime)
                }, function(err, item) {
                  if (err) throw err;
                  debug('file %s uploaded', uploadPath);
                  filesUploaded += 1;
                  console.log('%d files processed', (filesSkipped + filesUploaded));
                  next();
                });
              } else if (sha1 !== file.data.sha1) {
                if (options.overwrite) {
                  file.update(fs.createReadStream(filePath), {
                    filename: fileStat.name,
                    sha1: sha1,
                    content_created_at: timestamp(fileStat.ctime),
                    content_modified_at: timestamp(fileStat.mtime)
                  }, function(err, item) {
                    if (err) throw err;
                    debug('file %s updated', uploadPath);
                    filesUploaded += 1;
                    console.log('%d files processed', (filesSkipped + filesUploaded));
                    next();
                  });
                } else {
                  debug('file %s did not match sha1 but overwrite is not set', uploadPath);
                  filesErrored += 1;
                  console.log('err: file exists', uploadPath);
                  next();
                }
              } else {
                debug('file %s skipped', uploadPath);
                filesSkipped += 1;
                console.log('%d files processed', (filesSkipped + filesUploaded));
                next();
              }
            });
          });
        });
      });
    });
  });

program.parse(process.argv);
