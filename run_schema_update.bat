@echo off
echo Running database schema update...
mysql -u root -p capstone < update_booking_schema.sql
echo Schema update completed!
pause
