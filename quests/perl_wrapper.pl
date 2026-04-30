#!/usr/bin/perl
use strict;
use warnings;
use JSON;

# Read arguments from JSON passed via command line
my $json_arg = $ARGV[0] || '{}';
my $args = decode_json($json_arg);

# Populate global variables expected by EQEmu Perl scripts
our $text = $args->{text} || '';
our $name = $args->{name} || '';
our $class = $args->{class} || '';
our $race = $args->{race} || '';
our $ulevel = $args->{ulevel} || 1;
our %itemcount = %{ $args->{itemcount} || {} };
my $script_path = $args->{script_path};
my $event_type = $args->{event_type} || 'EVENT_SAY';

# Define the quest:: package to intercept calls and emit JSON commands
package quest;
use JSON;

sub emit {
    my ($action, $data) = @_;
    $data->{action} = $action;
    print encode_json($data) . "\n";
}

sub say { emit('say', { text => $_[0] }); }
sub shout { emit('shout', { text => $_[0] }); }
sub emote { emit('emote', { text => $_[0] }); }
sub summonitem { emit('summonitem', { item_id => $_[0], count => $_[1] || 1 }); }
sub exp { emit('exp', { amount => $_[0] }); }
sub ding { emit('ding', {}); }
sub me { emit('message', { color => 15, text => $_[0] }); }
sub taskselector { emit('taskselector', { task_id => $_[0] }); }
sub faction { emit('faction', { faction_id => $_[0], amount => $_[1] }); }
sub depop { emit('depop', { timer => $_[0] || 0 }); }
sub depop_withtimer { emit('depop', { timer => 1 }); }
sub spawn2 { emit('spawn2', { npc_id => $_[0], grid => $_[1], unused => $_[2], x => $_[3], y => $_[4], z => $_[5], h => $_[6] }); }

package plugin;
sub return_items {
    my $items = shift;
    my @returned = ();
    my $has_items = 0;
    foreach my $item_id (keys %$items) {
        my $count = $items->{$item_id};
        for (my $i = 0; $i < $count; $i++) {
            push(@returned, int($item_id));
            $has_items = 1;
        }
    }
    if ($has_items) {
        quest::say("I have no need for this, $name, you can have it back.");
        quest::emit('return_items', { returned => \@returned });
    }
}

package main;

# Execute the script
do $script_path;
if ($@) {
    quest::emit('error', { text => "Couldn't parse $script_path: $@" });
}

# Call the appropriate event function if it exists
if ($event_type eq 'EVENT_SAY' && defined &EVENT_SAY) {
    EVENT_SAY();
} elsif ($event_type eq 'EVENT_ITEM' && defined &EVENT_ITEM) {
    EVENT_ITEM();
} elsif ($event_type eq 'EVENT_COMBAT' && defined &EVENT_COMBAT) {
    EVENT_COMBAT();
} elsif ($event_type eq 'EVENT_DEATH' && defined &EVENT_DEATH) {
    EVENT_DEATH();
}

exit 0;
