/* global Phaser */
const game = new Phaser.Game(980, 500,
    (navigator.userAgent.toLowerCase().indexOf('firefox') > -1 ? Phaser.CANVAS : Phaser.AUTO),
    document.getElementById('game'), null, true, false);

export default game;

/*
= Final TODO list:
* Quick: readme about main functions?
* Put on Github
* Make blog (add links to it in github readme)
* About, Share, Source, Credits (indep from Phaser), License, ...
 ->Give credit for external tools (phaser-input etc.)
* Setup game analytics (http://www.gameanalytics.com/) and google analytics
*/
